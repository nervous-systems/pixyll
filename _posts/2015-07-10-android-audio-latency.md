---
layout: post
author: Moe Aboulkheir
title: Visualizing Android Audio Latency
date:       2015-07-10 11:21:29
summary: An interactive exploration of roundtrip audio latency on Android devices.
og_image: /images/android-og.png
thumbnail: /images/android-thumb.png
categories: android audio
tags: android audio
---

<link rel="stylesheet" type="text/css" href="/static/latency.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/3.5.5/d3.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3-tip/0.6.3/d3-tip.min.js"></script>

I'm currently working on a client's project, a part of which processes microphone input while
blaring audio out of the speaker --- and tries to make sense of the
relationship between the two signals.  Unfortunately, it's an Android project, and Android suffers from a lavishly documented<sup><a href="https://source.android.com/devices/audio/latency.html">1</a>,<a
href="http://createdigitalmusic.com/2013/05/why-mobile-low-latency-is-hard-explained-by-google-galaxy-nexus-still-android-of-choice/">2</a>,<a
href="http://stackoverflow.com/questions/14842803/low-latency-audio-playback-on-android">3</a></sup> [excess of audio latency](https://code.google.com/p/android/issues/detail?id=3434).

Long story short: For many applications, audio latency on Android is
unworkably high, and variations in latency between devices (and across
Android versions) are extreme.

Below is an attempt to figure out how high, and
how varied, using available data.

## Approach

Unlike either input or output latency in isolation, roundtrip latency can be
measured tolerably well with software<sup>1</sup>.  Software measurements trade
precision for convenience, and, as with all numbers, they're to be treated with
skepticism.

<div class="footnote">
<sup>1</sup> <small>There's a comprehensive description of various <a href="https://source.android.com/devices/audio/latency_measure.html">hardware & software approaches to audio latency measurement</a> over at the Android project.</small>
</div>

### Help

[Superpowered](http://superpowered.com/latency/) is an Android/IOS library for
audio processing.  Its developers have released a [roundtrip audio latency
measurement
application](https://github.com/superpoweredSDK/SuperpoweredLatency)<sup>1</sup>
which submits its results for aggregation.  The resulting data is
[available](http://superpowered.com/latency/), though not in a visually
digestible format.  I've attempted to re-visualize it below.

The measuring application doesn't use Superpowered itself<sup>2</sup> --- it's a
simple [OpenSL](https://en.wikipedia.org/wiki/OpenSL_ES) client which requests
the native sample rate & buffer size in order to ingratiate itself onto the
[fast path](https://source.android.com/devices/audio/latency_design.html) (if
supported).  It then burps out some sine waves and tries to detect them with the
microphone.

<div class="footnote">
<sup>1</sup> <small>The Android project also has some code for <a href="https://android.googlesource.com/platform/frameworks/wilhelm/+/master/tests/examples/slesTestFeedback.cpp">software latency measurement</a>, using a slightly different approach.</small><br />
<a id="superpowered-footnote"></a>
<sup>2</sup> <small>Superpowered is a well-designed library, and its stewards are doing a great job agitating for improvement of the audio latency situation on Android.  As opposed to the hard I/O limits visualized below, audio <i>processing</i> is amenable to a variety of software-based approaches to performance improvement &mdash; it's on this category of optimization that Superpowered's latency-reduction efforts are focused.</small>
</div>
## Data

Keep in mind that the same signal processing code used for these measurements
clocks in at <= 10ms across Apple mobile devices.

Also, prepare to collide with the fact that I am not a statistician.

### Hierarchically

Here, we're looking at latency averaged across manufacturer, device and OS
version, excluding devices with small numbers of samples (< 20).

A _sample_ corresponds to the value output by the data-gathering application after
each execution --- the average of 10 consecutive beep/listen cycles.

<script src="/static/latency-data.js"></script>

<div id="latency-graph-container"></div>
<script src="/static/latency.js"></script>
<script type="text/javascript">
  hierarchicalLatencyChart();
</script>

<div class="footnote">
 <ul>
 <li><small>The vertical axis is ordered by the number of samples per grouping (indicated in
the labels)</small></li>
 <li><small>The error bars represent the standard deviation</small></li>
 <li><small>Click the bars to descend, the background to ascend</small></li>
 </ul>
</div>

<div class="infobox">
<p>
<small>A small number of Samsung devices are compatible with (and ship with) the <a href="http://developer.samsung.com/galaxy#professional-audio">Samsung Professional Audio SDK</a>, which basically exposes
  <a href="http://jackaudio.org/">JACK</a> to Android applications &mdash;
 dramatically reducing audio latency (e.g. ~10-15ms in some configurations).
The Superpowered latency
measurer uses the Samsung SDK if available, however I've chosen
to exclude the SDK-enhanced values from these results.
<br><br>
Unless an application is
targeted at the subset of Samsung devices which support the SDK &mdash; or engages an alternate code path
 for audio I/O when it's available &mdash; the numbers aren't going to be relevant.</small>
</p>
</div>

### Top 20

#### Popular Devices

The twenty devices on which measurements have most often been taken:

<div class="grouped-chart-container" id="latency-pop-container"></div>
<script type="text/javascript">
  groupedLatencyGraph('#latency-pop-container', latencyData.latencyPop);
</script>

<div class="footnote"><small>Missing bars indicate insufficient data for one or other version.</small></div>

#### Lowest-Latency Devices

Let's take a look at the top twenty devices by average latency, across all OS
versions.  Mostly, this group is comprised of devices for which we don't have pre-5.0 data
(the higher latencies on old builds would throw off the mean).

<div class="grouped-chart-container" id="latency-scores-container"></div>
<script type="text/javascript">
  groupedLatencyGraph('#latency-scores-container', latencyData.latencyScores);
</script>

<div class="footnote"><small>Devices with fewer than two samples are excluded.</small></div>

### Devices by Build Version

Per-build information for two of the more popular devices in the data:

#### LG Nexus 5

We've got plenty of Nexus 5 samples --- let's put them to work:

<div id="nexus-graph-container" class="device-graph-container"></div>

#### Samsung S3

<div id="s3-graph-container" class="device-graph-container"></div>
<script>
  latencyGraph('#nexus-graph-container', latencyData.nexus);
  latencyGraph('#s3-graph-container', latencyData.s3);
</script>

Man, where's that _Professional Audio SDK_ when you need it?

## Winding Down

Congratulations on making it this far.

As I've been discovering in practice, comedically wide tolerances are required
for any degree of portable, interdependent audio I/O on Android.

For those working on similar problems &mdash; and so presumably wallowing in similarly-dimensioned pits of despair &mdash; I hope this
process of naming and quantifying our agonies in some way diminishes them.