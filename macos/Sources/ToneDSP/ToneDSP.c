#include "ToneDSP.h"
#include <Accelerate/Accelerate.h>
#include <math.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define BANDS 12
#define QUEUE 32
#define CAPTURE 65536
typedef struct { double b0, b1, b2, a1, a2; } Coeff;
typedef struct { Coeff c[BANDS]; double gain; } Config;
typedef struct { Config config; double z1[2][BANDS], z2[2][BANDS]; } Bank;
struct TBProcessor {
    double rate;
    Config queue[QUEUE];
    _Atomic uint32_t write, read;
    _Atomic uint64_t callbacks, faults, clipped;
    Bank bank[2];
    uint32_t active, fade, fade_length;
    bool initialized;
    // SPSC frame ring: the callback only copies samples, never runs an FFT.
    float capture[CAPTURE][4];
    _Atomic uint32_t capture_write, capture_read;
    uint32_t capture_position;
    bool capturing;
    FFTSetup fft;
    uint32_t fft_size, fft_log2, history_position, history_count;
    float *history, *window, *real, *imag, *power;
};
static Coeff identity(void) { return (Coeff){1, 0, 0, 0, 0}; }
static Coeff coefficients(TBBand b, double rate) {
    if (!b.enabled) return identity();
    // Keep centers below Nyquist, matching the UI's response calculation.
    double f = fmin(b.frequency, rate * 0.499);
    double w = 2 * M_PI * f / rate, c = cos(w), s = sin(w);
    double a = pow(10, b.gain / 40), alpha = s / (2 * b.q);
    double beta = 2 * sqrt(a) * alpha;
    double b0, b1, b2, a0, a1, a2;
    if (b.kind == 1) {
        b0 = a*(a+1-(a-1)*c+beta); b1 = 2*a*(a-1-(a+1)*c); b2 = a*(a+1-(a-1)*c-beta);
        a0 = a+1+(a-1)*c+beta; a1 = -2*(a-1+(a+1)*c); a2 = a+1+(a-1)*c-beta;
    } else if (b.kind == 2) {
        b0 = a*(a+1+(a-1)*c+beta); b1 = -2*a*(a-1+(a+1)*c); b2 = a*(a+1+(a-1)*c-beta);
        a0 = a+1-(a-1)*c+beta; a1 = 2*(a-1-(a+1)*c); a2 = a+1-(a-1)*c-beta;
    } else {
        b0 = 1+alpha*a; b1 = -2*c; b2 = 1-alpha*a;
        a0 = 1+alpha/a; a1 = -2*c; a2 = 1-alpha/a;
    }
    return (Coeff){b0/a0, b1/a0, b2/a0, a1/a0, a2/a0};
}
static bool valid(const TBBand *bands, uint32_t count, double rate) {
    if (count > BANDS || (count && !bands) || !isfinite(rate) || rate < 32000 || rate > 192000) return false;
    for (uint32_t i=0; i<count; i++) {
        TBBand b = bands[i];
        if (b.kind < 0 || b.kind > 2 || !isfinite(b.frequency) || b.frequency < 20 || b.frequency > 20000 ||
            !isfinite(b.gain) || b.gain < -18 || b.gain > 12 || !isfinite(b.q) || b.q < .25 || b.q > 10) return false;
    }
    return true;
}
double tb_headroom(const TBBand *bands, uint32_t count, double rate) {
    if (!valid(bands, count, rate)) return NAN;
    Coeff filters[BANDS];
    for (uint32_t j=0; j<count; j++) filters[j] = coefficients(bands[j], rate);
    double maximum = 0, high = rate * .499;
    for (uint32_t i=0; i<1601+count; i++) {
        double f = i<1601 ? 20*pow(high/20, (double)i/1600) : fmin(bands[i-1601].frequency, high);
        double w = 2*M_PI*f/rate, total = 0;
        for (uint32_t j=0; j<count; j++) {
            Coeff c = filters[j];
            double re = c.b0+c.b1*cos(w)+c.b2*cos(2*w), im = c.b1*sin(w)+c.b2*sin(2*w);
            double dr = 1+c.a1*cos(w)+c.a2*cos(2*w), di = c.a1*sin(w)+c.a2*sin(2*w);
            total += 10*log10(fmax(1e-20,re*re+im*im)/fmax(1e-20,dr*dr+di*di));
        }
        maximum = fmax(maximum, total);
    }
    return maximum < 1e-7 ? 0 : -ceil((maximum+.5)*10-1e-8)/10;
}
TBProcessor *tb_create(double rate) {
    if (!valid(NULL, 0, rate)) return NULL;
    TBProcessor *p = calloc(1, sizeof(*p));
    if (!p) return NULL;
    atomic_init(&p->write, 0); atomic_init(&p->read, 0);
    atomic_init(&p->callbacks, 0); atomic_init(&p->faults, 0); atomic_init(&p->clipped, 0);
    atomic_init(&p->capture_write, 0); atomic_init(&p->capture_read, 0);
    if (!atomic_is_lock_free(&p->write) || !atomic_is_lock_free(&p->callbacks)) { free(p); return NULL; }
    p->rate = rate; p->fade_length = (uint32_t)(rate*.02);
    p->fft_log2 = rate <= 48000 ? 13 : rate <= 96000 ? 14 : 15;
    p->fft_size = 1u << p->fft_log2;
    p->fft = vDSP_create_fftsetup(p->fft_log2, kFFTRadix2);
    p->history = calloc(p->fft_size * 4, sizeof(float));
    p->window = calloc(p->fft_size, sizeof(float));
    p->real = calloc(p->fft_size, sizeof(float));
    p->imag = calloc(p->fft_size, sizeof(float));
    p->power = calloc(p->fft_size, sizeof(float));
    if (!p->fft || !p->history || !p->window || !p->real || !p->imag || !p->power) {
        tb_destroy(p); return NULL;
    }
    for (uint32_t i=0; i<p->fft_size; i++) p->window[i] = .5-.5*cos(2*M_PI*i/p->fft_size);
    for (int k=0; k<2; k++) {
        p->bank[k].config.gain = 1;
        for (int j=0; j<BANDS; j++) p->bank[k].config.c[j] = identity();
    }
    return p;
}
void tb_destroy(TBProcessor *p) {
    if (!p) return;
    if (p->fft) vDSP_destroy_fftsetup(p->fft);
    free(p->history); free(p->window); free(p->real); free(p->imag); free(p->power); free(p);
}
static void capture_begin(TBProcessor *p, uint32_t frames) {
    uint32_t w = atomic_load_explicit(&p->capture_write, memory_order_relaxed);
    uint32_t r = atomic_load_explicit(&p->capture_read, memory_order_acquire);
    p->capturing = frames < CAPTURE && frames <= (r-w-1u) % CAPTURE;
    p->capture_position = w;
}
static void capture_end(TBProcessor *p) {
    if (p->capturing) atomic_store_explicit(&p->capture_write, p->capture_position, memory_order_release);
}
bool tb_update(TBProcessor *p, const TBBand *bands, uint32_t count, double preamp, bool bypass) {
    if (!p || !valid(bands,count,p->rate) || !isfinite(preamp) || preamp < -180 || preamp > 0) return false;
    uint32_t w = atomic_load_explicit(&p->write,memory_order_relaxed);
    uint32_t next = (w+1)%QUEUE;
    if (next == atomic_load_explicit(&p->read,memory_order_acquire)) return false;
    Config config;
    config.gain = pow(10,preamp/20);
    for (uint32_t j=0; j<BANDS; j++) config.c[j] = j<count && !bypass ? coefficients(bands[j],p->rate) : identity();
    p->queue[w] = config;
    atomic_store_explicit(&p->write,next,memory_order_release);
    return true;
}
static void begin(TBProcessor *p) {
    if (p->fade) return;
    uint32_t r = atomic_load_explicit(&p->read,memory_order_relaxed);
    uint32_t w = atomic_load_explicit(&p->write,memory_order_acquire);
    if (r==w) return;
    Config config = p->queue[(w+QUEUE-1)%QUEUE];
    atomic_store_explicit(&p->read,w,memory_order_release);
    uint32_t next = p->initialized ? 1-p->active : p->active;
    memset(&p->bank[next],0,sizeof(Bank));
    p->bank[next].config = config;
    if (p->initialized) p->fade = 1;
    p->initialized = true;
}
static double sample(Bank *b, int channel, double x) {
    x *= b->config.gain;
    for (int j=0; j<BANDS; j++) {
        Coeff c = b->config.c[j];
        double y = c.b0*x+b->z1[channel][j];
        b->z1[channel][j] = c.b1*x-c.a1*y+b->z2[channel][j];
        b->z2[channel][j] = c.b2*x-c.a2*y;
        if (fabs(b->z1[channel][j])<1e-24) b->z1[channel][j]=0;
        if (fabs(b->z2[channel][j])<1e-24) b->z2[channel][j]=0;
        x=y;
    }
    return x;
}
static void frame(TBProcessor *p, float l, float r, float *ol, float *orr) {
    double out[2], in[2] = {l,r};
    for (int c=0; c<2; c++) {
        out[c] = sample(&p->bank[p->active],c,in[c]);
        if (p->fade) {
            double mix = (double)p->fade/p->fade_length;
            out[c] = out[c]*(1-mix)+sample(&p->bank[1-p->active],c,in[c])*mix;
        }
        if (!isfinite(out[c])) { out[c]=0; atomic_fetch_add_explicit(&p->faults,1,memory_order_relaxed); }
        if (fabs(out[c])>1) { out[c]=fmax(-1,fmin(1,out[c])); atomic_fetch_add_explicit(&p->clipped,1,memory_order_relaxed); }
    }
    *ol=(float)out[0]; *orr=(float)out[1];
    if (p->capturing) {
        float *v = p->capture[p->capture_position];
        v[0] = isfinite(l) ? l : 0; v[1] = isfinite(r) ? r : 0;
        v[2] = *ol; v[3] = *orr;
        p->capture_position = (p->capture_position+1) % CAPTURE;
    }
    if (p->fade && ++p->fade>p->fade_length) { p->fade=0; p->active=1-p->active; }
}
void tb_process(TBProcessor *p, const float *l, const float *r, float *ol, float *orr, uint32_t frames) {
    begin(p);
    capture_begin(p, frames);
    for (uint32_t i=0; i<frames; i++) frame(p,l[i],r[i],&ol[i],&orr[i]);
    capture_end(p);
}
static bool layout(const AudioBufferList *b, uint32_t *frames) {
    if (!b) return false;
    if (b->mNumberBuffers==1 && b->mBuffers[0].mNumberChannels==2 && b->mBuffers[0].mData && b->mBuffers[0].mDataByteSize%8==0) {
        *frames=b->mBuffers[0].mDataByteSize/8; return true;
    }
    if (b->mNumberBuffers==2 && b->mBuffers[0].mNumberChannels==1 && b->mBuffers[1].mNumberChannels==1 &&
        b->mBuffers[0].mData && b->mBuffers[1].mData && b->mBuffers[0].mDataByteSize==b->mBuffers[1].mDataByteSize && b->mBuffers[0].mDataByteSize%4==0) {
        *frames=b->mBuffers[0].mDataByteSize/4; return true;
    }
    return false;
}
OSStatus tb_io_proc(AudioObjectID device, const AudioTimeStamp *now, const AudioBufferList *input,
    const AudioTimeStamp *input_time, AudioBufferList *output, const AudioTimeStamp *output_time, void *context) {
    TBProcessor *p=context;
    uint32_t nf=0, no=0;
    atomic_fetch_add_explicit(&p->callbacks,1,memory_order_relaxed);
    if (!layout(input,&nf) || !layout(output,&no) || nf!=no) {
        if (output) for (uint32_t i=0; i<output->mNumberBuffers; i++) if (output->mBuffers[i].mData) memset(output->mBuffers[i].mData,0,output->mBuffers[i].mDataByteSize);
        atomic_fetch_add_explicit(&p->faults,1,memory_order_relaxed);
        return noErr;
    }
    const float *il=input->mBuffers[0].mData;
    const float *ir=input->mBuffers[input->mNumberBuffers==1?0:1].mData;
    float *ol=output->mBuffers[0].mData;
    float *orr=output->mBuffers[output->mNumberBuffers==1?0:1].mData;
    uint32_t ins=input->mNumberBuffers==1?2:1, outs=output->mNumberBuffers==1?2:1;
    if (ins==2) ir++;
    if (outs==2) orr++;
    begin(p);
    capture_begin(p, nf);
    for (uint32_t i=0; i<nf; i++) frame(p,il[i*ins],ir[i*ins],&ol[i*outs],&orr[i*outs]);
    capture_end(p);
    return noErr;
}
uint64_t tb_callbacks(TBProcessor *p) { return atomic_load_explicit(&p->callbacks,memory_order_relaxed); }
uint64_t tb_faults(TBProcessor *p) { return atomic_load_explicit(&p->faults,memory_order_relaxed); }
uint64_t tb_clipped(TBProcessor *p) { return atomic_load_explicit(&p->clipped,memory_order_relaxed); }
uint32_t tb_spectrum_fft_size(TBProcessor *p) { return p->fft_size; }
bool tb_read_spectrum(TBProcessor *p, float *frequencies, float *before, float *after) {
    uint32_t r = atomic_load_explicit(&p->capture_read, memory_order_relaxed);
    uint32_t w = atomic_load_explicit(&p->capture_write, memory_order_acquire);
    if (r == w) return false;
    uint32_t n = p->fft_size;
    while (r != w) {
        memcpy(p->history + p->history_position*4, p->capture[r], 4*sizeof(float));
        p->history_position = (p->history_position+1) % n;
        if (p->history_count < n) p->history_count++;
        r = (r+1) % CAPTURE;
    }
    atomic_store_explicit(&p->capture_read, r, memory_order_release);
    if (p->history_count < n) return false;
    double high = fmin(20000, p->rate/2);
    double ratio = high/20;
    for (uint32_t b=0; b<TB_SPECTRUM_BINS; b++) frequencies[b] = 20*pow(ratio, (b+.5)/TB_SPECTRUM_BINS);
    for (int pair=0; pair<2; pair++) {
        memset(p->power, 0, (n/2+1)*sizeof(float));
        for (int channel=0; channel<2; channel++) {
            for (uint32_t i=0; i<n; i++) {
                uint32_t position = (p->history_position+i) % n;
                p->real[i] = p->history[position*4+pair*2+channel] * p->window[i];
            }
            memset(p->imag, 0, n*sizeof(float));
            DSPSplitComplex split = {p->real, p->imag};
            vDSP_fft_zip(p->fft, &split, 1, p->fft_log2, FFT_FORWARD);
            // Complex FFT has no real-FFT factor of two. Sum Hann = N/2.
            double scale = 4.0/n;
            for (uint32_t k=1; k<=n/2; k++) {
                double a = p->real[k]*scale, b = p->imag[k]*scale;
                p->power[k] += .5*(a*a+b*b);
            }
        }
        float *dest = pair == 0 ? before : after;
        for (uint32_t b=0; b<TB_SPECTRUM_BINS; b++) {
            uint32_t first = (uint32_t)ceil(20*pow(ratio, (double)b/TB_SPECTRUM_BINS)*n/p->rate);
            uint32_t last = (uint32_t)ceil(20*pow(ratio, (double)(b+1)/TB_SPECTRUM_BINS)*n/p->rate);
            double maximum = 0;
            if (last <= first) {
                uint32_t nearest = (uint32_t)llround(frequencies[b]*n/p->rate);
                maximum = p->power[nearest < 1 ? 1 : nearest > n/2 ? n/2 : nearest];
            } else for (uint32_t k=first; k<last && k<=n/2; k++) maximum = fmax(maximum, p->power[k]);
            dest[b] = fmax(-120, 10*log10(fmax(1e-12, maximum)));
        }
    }
    return true;
}
