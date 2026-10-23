#ifndef TONE_DSP_H
#define TONE_DSP_H
#include <CoreAudio/CoreAudio.h>
#include <stdbool.h>
#include <stdint.h>

typedef struct TBProcessor TBProcessor;
typedef struct {
    int32_t kind; // 0: peak, 1: low shelf, 2: high shelf
    bool enabled;
    double frequency, gain, q;
} TBBand;

TBProcessor * _Nullable tb_create(double sample_rate);
void tb_destroy(TBProcessor * _Nullable processor);
// Single control-thread producer; false means invalid input or queue full.
bool tb_update(TBProcessor * _Nonnull, const TBBand * _Nullable, uint32_t count, double preamp, bool bypass);
double tb_headroom(const TBBand * _Nullable, uint32_t count, double sample_rate);
// Audio thread only; planar buffers also provide a testable DSP entry point.
void tb_process(TBProcessor * _Nonnull, const float * _Nonnull left, const float * _Nonnull right,
                float * _Nonnull out_left, float * _Nonnull out_right, uint32_t frames);
OSStatus tb_io_proc(AudioObjectID, const AudioTimeStamp * _Nonnull, const AudioBufferList * _Nonnull,
                    const AudioTimeStamp * _Nonnull, AudioBufferList * _Nonnull,
                    const AudioTimeStamp * _Nonnull, void * _Nullable);
uint64_t tb_callbacks(TBProcessor * _Nonnull);
uint64_t tb_faults(TBProcessor * _Nonnull);
uint64_t tb_clipped(TBProcessor * _Nonnull);
#endif
