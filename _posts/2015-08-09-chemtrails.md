---
layout: post
author: Moe Aboulkheir
title: Chasing Chemtrails with Clojurescript
summary: Or, cloud computing.
og_image: /images/chemtrack-large.png
categories: clojure clojurescript node aws
tags: clojure clojurescript node aws lambda
date: 2015-08-09 17:37:00
---

<div class="thumbnail-right">
<img src="/images/rainbow.jpg">
</div>

As computer programmers, we appreciate the importance of humiliation as a
catalyst of individual development: it's axiomatic that no amount of
encouragement or generosity can equal the force of well-crafted abasement.

I've spent much of the last year applying this principle to the area of
self-improving software. My research centers on the generation of gratuitously
complex programs and --- to put it delicately --- _sustaining their mistreatment_.
Denying the fact of their existence, goading them into combat with nightmarish
parodies of themselves, threatening them with the [Free Tier](https://aws.amazon.com/free/), etc.  An effort which now concludes
with an admission of defeat.

In spite of my dedicated attention and unrestrained expense, I've proved
incapable<sup>1</sup> of teasing out a splinter of ambition from my offspring.

Amid these difficulties, the jet engines tearing over my tower block are a
welcome distraction, and their luxuriant plumes a topic of fascination.  I've
moved my workstation beside the window, and lose days in glazed and pleasant
thoughtlessness.  My sense of identity dissipating in a kind of harmony with the
sky's gentle currents.

There's a narcotic effect to the exhaust --- subtle, cumulative --- my
bitterness mellows, mailbox fills.  Chewing AWS invoices keeps me from
fainting. I'm fashioning a kind of deckchair for the rooftop, to more
effectively absorb my medication.

<p class="footnote"><sup>1</sup> <small>That word, <i>incapable</i>, waits for quiet moments before detonating and reassembling in
my mind.</small>
</p>

## Software

<div class="thumbnail-right" style="width: 300px">
<a href="http://chemtrack.nervous.io" name="Chemtrack Demo"><img src="/images/chemtrack.png" alt="Chemtrack Screenshot"></a>
</div>

I'd like to help others locate the highest regional concentrations of
chemical-delivering planes, grouped by quality & composition of exhaust.
A Lisp seems a natural choice for implementation language.

The specific technical goal is a small, self-contained web application using
Clojurescript in as many places as possible (which is _everywhere_, it turns
out): a [Node](https://nodejs.org/) backend atop
[Express](http://expressjs.com/), browser frontend using
[Reagent](https://reagent-project.github.io/), and an [AWS
Lambda](http://docs.aws.amazon.com/lambda/latest/dg/welcome.html) function, via
[cljs-lambda](https://github.com/nervous-systems/cljs-lambda).

Socially, the goal is to contribute to a sense of loss and guilt in at least one
Node/Javascript developer.  Node has been incredibly successful as a platform
--- it'd be heartwarming to see more backend Clojurescript development
happening.

The demo source is [available on GitHub](https://github.com/nervous-systems/chemtrack-example).  What follows is a detailed walkthrough of the project.

<div class="footnote"> N.B. <small>I've not used Reagent before, and don't really even know what Express <i>is</i>.  I've attempted to conceal possible errors with excessive, misleading commentary.</small>
</div>

### Supporting Libraries

<div class="thumbnail-right">
<img src="/images/bird.jpg" alt="Big Bird + Chemtrails" style="width: 300px" />
</div>

Prior to writing this post, I spent some time modifying a couple of
Clojure AWS libraries to run on Clojurescript/Node:

- [Hildebrand](https://github.com/nervous-systems/hildebrand/) (Dynamo/Streams)
- [Fink-Nottle](https://github.com/nervous-systems/fink-nottle) (SQS, SNS)
- [Eulalie](https://github.com/nervous-systems/eulalie) (the underlying AWS client)

Which is exciting news: in addition to not using these libraries from Clojure, you can now not use them from Clojurescript.

Once we have a simple Node backend running, we'll extend it to rely on some of
 the AWS services exposed by the above libraries.

## Structure

<ul class="dir-layout">
<li><a href="https://github.com/nervous-systems/chemtrack-example/blob/master/project.clj">project.clj</a></li>
<li>backend/chemtrack/
  <ul>
    <li><a href="https://github.com/nervous-systems/chemtrack-example/blob/master/backend/chemtrack/backend.cljs">backend.cljs</a></li>
    <li>...</li>
  </ul>
</li>
<li>frontend/chemtrack/
  <ul>
      <li><a href="https://github.com/nervous-systems/chemtrack-example/blob/master/frontend/chemtrack/frontend.cljs">frontend.cljs</a></li>
    <li>...</li>
  </ul>
</li>
<li>lambda/chemtrack/
  <ul>
      <li><a href="https://github.com/nervous-systems/chemtrack-example/blob/master/lambda/chemtrack/lambda.cljs">lambda.cljs</a></li>
  </ul>
</li>
</ul>

A single [Leiningen](http://leiningen.org/) [project.clj](https://github.com/nervous-systems/chemtrack-example/blob/master/project.clj) governs the example, with each component (front, back, Lambda) having its own
[cljsbuild](https://github.com/emezeske/lein-cljsbuild) entry and distinct
`:source-paths`.

For the purposes of demonstration, we're compiling the frontend into
`resources/public` & serving it statically from our Express-based Node
backend<sup>1</sup>.

In practice, one simple deployment approach would be [Elastic
Beanstalk](http://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html)<sup>2</sup>,
which has Node support and a simple static file provision.

<p class="footnote"><sup>1</sup> <small>I developed the project using <a
href="https://github.com/bhauman/lein-figwheel">Figwheel</a> for both Node &amp;
browser, though removed the sticky-state/reload stuff for clarity &mdash;
there's enough going on.  <a href="https://gist.github.com/bhauman/c63123a5c655d77c3e7f">Bruce Hauman has a helpful Gist</a> outlining a Node/Express/Figwheel setup.</small>
<br>
<sup>2</sup><small>   I've previously covered <a href="/clojure/async/sns/eb/docker/2015/06/22/sns-beanstalk-chat/">the use of Docker in Clojure Elastic Beanstalk applications</a>.</small>
</p>

## Backend, Mark I

<div class="infobox">
<div class="infobox-title">Real Life</div>
<p>
We're not handling errors, ever, anywhere, or even acknowledging their possibility.
</p>
</div>

<div style="float: right">
<a href="/images/mult-flow-large.png" title="Two clients and a mult">
<img src="/images/mult-flow-large.png" alt="Two clients and a mult" style="width: 300px" />
</a>
</div>

In order to minimize Node/Express interop,  let's keep the backend
interface small - a single Websocket endpoint used both for accepting new
chemtrail sightings and broadcasting their creation.

The plan is to use [core.async](https://github.com/clojure/core.async) for
all I/O & communication, which'll help us incorporate new data
streams with minimum disruption.

The values passing over the channels/websockets look a lot like this:

```clojure
{:city "San Antonio"
 :elements #{:al :sr}
 :timestamp 1438466048050
 :severity 5}
```

### Implementation

```clojure
(ns chemtrack.backend
  (:require [cljs.core.async :as async]
            [cljs.nodejs :as nodejs]
            [chemtrack.backend.util :as util]))

(defn make-sightings-handler [{:keys [sightings-out sightings-in]}]
  (let [sightings-out* (async/mult sightings-out)]
    (fn [websocket _]
      (let [from-client (async/chan 1 (map util/sighting-in))
            to-client   (async/chan 1 (map util/sighting-out))]
        (async/pipe from-client sightings-in false)
        (async/tap sightings-out* to-client)
        (util/channel-websocket!
         websocket to-client from-client)))))
```
<small class="commentary">
We're creating the handler for incoming websocket requests: the function is called once, at route-registration time, and passed the two channels which form the core of the application.  Each time the returned handler is invoked, it `pipe`s messages from its client onto the shared `sightings-in` channel, and taps a `mult[iple]` of the communal, outgoing channel onto _its_ client's out channel.</small>
<small class="commentary">The use of buffers is only to enable basic [transformation of channel values](http://clojure.org/transducers): [`util/channel-websocket!`](https://github.com/nervous-systems/chemtrack-example/blob/master/backend/chemtrack/backend/util.cljs#L33) is immediately consuming values from `to-client`, and closing both client channels when the connection terminates.  Any delay in the consumption of values on `to-client` (e.g. if we were waiting until the websocket implementation confirmed the send, and something went wrong) would congest the `mult` --- and delay writes to all other clients.</small>

```clojure
(defn connect-channels
  [{:keys [sightings-out sightings-in]}]
  (async/pipe sightings-in sightings-out))
```
<small class="commentary">As this is initially a single-instance service with no persistence, this `pipe` (in concert with the `mult` above), is sufficient to broadcast all writes to all readers. This, and `make-sightings-handler` basically comprise the application-specific logic.</small>

```clojure
(def http       (nodejs/require "http"))
(def express    (nodejs/require "express"))
(def express-ws (nodejs/require "express-ws"))

(defn register-routes [app channels]
  (doto app
    (.use (.static express "resources/public"))
    (.ws  "/sightings" (make-sightings-handler channels))))

(defn make-server [app]
  (let [server (.createServer http app)]
    (express-ws app server)
    server))

(defn -main [& [{:keys [port] :or {port 8080}}]]
  (let [channels {:sightings-in  (async/chan)
                  :sightings-out (async/chan)}
        app      (express)
        server   (make-server app)]

    (register-routes app channels)
    (connect-channels channels)
    (.listen server port)))

(set! *main-cli-fn* -main)
```

<small class="commentary">This part is much more pleasant than I was imagining.</small>

## Frontend

<div class="thumbnail-right" style="width: 300px">
<img src="/images/reagent.png">
</div>

I made a careful survey of <strike>the mystical import of the names of various</strike> Clojurescript React wrappers, and feel
pretty secure in my decision of Reagent.

As with the backend, the center of the client consists of two channels:
`sightings-out` & `sightings-in`.  Incoming sightings feed into an atom windowed over
the 10 most recent, as I lack the expertise required for pagination.

<div style="clear: right"></div>
```clojure
(ns chemtrack.frontend
  (:require [reagent.core :as reagent]
            [reagent-forms.core :as reagent-forms]
            [chord.client :as chord]
            [cljs.core.async :as async :refer [<!]]
            [chemtrack.frontend.render :as render]
            [chemtrack.frontend.util :as util])
  (:require-macros [cljs.core.async.macros :refer [go]]))

(def recent-container
  (let [key-fn (juxt :timestamp :city :elements)]
    (sorted-set-by #(compare (key-fn %1) (key-fn %2)))))
```
<small class="commentary">
Let's not rely on the sightings arriving in perfect sorted order, so we don't have to revisit this.  This isn't state --- we're creating an immutable collection to later wrap in atom and pass around.  Outside of a narrated example, there wouldn't be much reason to stick this here.
</small>

```clojure
(defn ws-loop! [recent sightings-out &
               [{:keys [max-items] :or {max-items 10}}]]
  (go
    (let [{sightings-in :ws-channel}
          (<! (chord/ws-ch
               (util/relative-ws-url "sightings")
               {:write-ch sightings-out}))]
      (loop []
        (when-let [{sighting :message} (<! sightings-in)]
          (swap! recent util/conj+evict sighting max-items)
          (recur))))))
```

<small class="commentary">We tell [Chord](https://github.com/jarohen/chord)'s `ws-ch` to
retrieve its values from the channel of outgoing sightings (see below) --- it
takes care of flattening the EDN.  `conj+evict`  removes the first (oldest) item from the sorted set when it reaches `max-items` in length.
</small>

```clojure
(defn bind-form [config]
  (let [sighting (reagent/atom {})]
    [reagent-forms/bind-fields
     (render/form sighting config)
     sighting]))
```

<small class="commentary">
[reagent-forms](https://github.com/reagent-project/reagent-forms) updates the
`sighting` atom with any changes made via the user-facing form.  This is tied
together by `render/form`, which supplies a form submit handler responsible for
dereferencing `sighting` and placing its value on `sightings-out` ---
sending the map to the backend. </small>

```clojure
(defn mount-root []
  (let [sightings-out (async/chan)
        recent        (reagent/atom recent-container)]
    (ws-loop! recent sightings-out)
    (reagent/render
     [render/app
      bind-form
      {:sightings-out sightings-out
       :elements {:ag "Aluminum"
                  :ba "Barium"
                  :th "Thorium"
                  :si "Silicon Carbide"
                  :sr "Strontium"}
       :recent recent}]
     (.getElementById js/document "app"))))

(mount-root)
```

<small class="commentary">As far as `render/app` and `render/form`: I put
together an intentionally hobbled templating scheme to allow the markup &
rendering (template substitution) to remain as naive as possible.
[render.cljs](https://github.com/nervous-systems/chemtrack-example/blob/master/frontend/chemtrack/frontend/render.cljs)
&
[template.cljs](https://github.com/nervous-systems/chemtrack-example/blob/master/frontend/chemtrack/frontend/template.cljs) are the relevant files.</small>

## Backend, Mark II

<div style="float: right; padding: 0 0 12px 12px">
<a href="/images/queue-flow-large.png" title="Uselessly abstract diagram">
<img src="/images/queue-flow-large.png" alt="Uselessly abstract diagram" style="width: 300px" />
</a>
</div>

Now that we've got _something_, let's extend it so that we can run multiple
instances of the backend, with each aware of items created via their peers.
A previous post looked at [using SNS for ad-hoc instance
coordination](/clojure/async/sns/eb/docker/2015/06/22/sns-beanstalk-chat/) ---
this time, we're going to try combining SNS with SQS, arriving at something a
little more natural to consume.

The application is now expected to place outgoing sightings onto a predictably
 named SNS topic, with SNS pushing the values to the topic's subscribers: a
 collection of SQS queues, one for every instance of the Node backend.  Each
 time the Node process starts somewhere, it creates a queue with a name
 corresponding to its instance / port<sup>1</sup> (or purges it, if the queue
 already exists) & subscribes it to the shared topic.

<div class="footnote"><sup>1</sup> <small>We're shirking cleanup duty, and would rather the queues be reused where possible.  In an environment with high instance churn, we'd want to allow for the removal of unused queues.
</div>

### Implementation

`connect-channels` has sprouted some dependencies, and its body needs an upgrade
.  We're going to use Lambda to house the queue creation logic, so things don't
need to change _too_ dramatically.

```clojure
(ns chemtrack.backend
  (:require ...
            [fink-nottle.sqs.channeled :as sqs]
            [fink-nottle.sns :as sns]
            [cljs.reader :refer [read-string]))

(defn sns-push-loop! [creds topic-id sightings-in]
  (go
    (loop []
      (let [item (<! sightings-in)]
        (sns/publish-topic!
         creds topic-id {:default (pr-str item)})
        (recur)))))
```
<small class="commentary">Messages from users are handled by draining  `sightings-in` (sightings coming _in_ from the client) and calling `sns/publish-topic!` ([Fink-Nottle](https://github.com/nervous-systems/fink-nottle)) on each.
</small>

```clojure
(defn sqs-incoming!
  [deletes {:keys [body] :as message} results]
  (let [body (read-string body)]
    (go
      (>! results body)
      (>! deletes message)
      (close! results))))
```

<small class="commentary">This function is used in a `pipeline-async` call
below --- while maybe a little heavyweight for this kind of process, the `pipeline`-based implementation reads the clearest.  Some additional processing (storing incoming items in an in-memory queue) has been removed for clarity.
</small>
<small class="commentary">The `message` map consists of attributes/metadata and a string body.  The SNS topic is set up to deliver `raw` messages --- the content of each SNS notification appears verbatim as the body of each SQS message.
</small>
<br>
<div class="infobox">
<div class="infobox-title">Moral Support</div>
<p>
If things are starting to get tedious, remember: this is all happening in a Javascript runtime.
</p>
</div>

```clojure
(defn connect-channels!
  [{:keys [port topic-name creds max-recent] :as config}
   {:keys [sightings-out sightings-in recent] :as channels}]
  (go
    (let [{:keys [queue-id topic-id]}
          (<! (util/topic-to-queue! config))]
      (sns-push-loop! creds topic-id sightings-in)
      (let [{deletes :in-chan}
            (sqs/batching-deletes creds queue-id)]
        (async/pipeline-async
         1
         sightings-out
         (partial sqs-incoming! deletes)
         (sqs/receive! creds queue-id))))))
```
<small class="commentary">
There's no longer any in-application connection between the outgoing and
incoming sightings --- AWS is tying them together: a channel containing messages received from our private SQS queue is being pipelined to `sightings-out` via the deletion/parsing logic above. See the [fink-nottle.sqs.channeled documentation](https://github.com/nervous-systems/fink-nottle/wiki/sqs.channeled) for details of `batching-deletes` and `receive!`
</small>

## Lambda

Being more general than much of the above, there's some sense in us exposing the
topic/queue bridging logic as a Lambda function.  As its possible to [write
Lambda functions in
Clojurescript](/clojure/clojurescript/aws/lambda/node/lein/2015/07/05/lambda/),
it seems rude not to.

We won't get into the details of the helpers used by
`topic-to-queue` --- a bunch of interdependent/sequential I/O, & ugly API
details, much like the Lambda entry-point:

```clojure
(def ^:export topic-to-queue
  (async-lambda-fn
   (fn [{:keys [topic-name queue-name]} context]
     (go
       (let [creds (eulalie.creds/env)
             topic-arn (<! (sns/create-topic! creds topic-name))
             {:keys [queue-url queue-arn]}
             (<! (create-queue! creds queue-name))]
         (<! (subscribe-queue! creds queue-arn topic-arn))
         {:topic-id topic-arn :queue-id queue-url})))))
```
<small class="commentary">
`:topic-name` and `:queue-name` in, `:topic-id` (ARN) and `:queue-id` (URL) out.</small>
<small class="commentary">`eulalie.creds/env` fetches credentials from environment variables.  In the case of a Lambda deployment, these'll correspond to the IAM role the function is executing under.
</small>

### Deployment

```sh
chemtrack-example$ lein cljs-lambda deploy
```

### Invocation

Assuming the function is [associated](https://github.com/nervous-systems/cljs-lambda#projectclj-excerpt) with an IAM role having sufficient SQS/SNS permissions:

```clojure
(eulalie.lambda.util/request!
 creds :topic-to-queue
 {:topic-name topic-name
  :queue-name queue-name})
```
<small class="commentary">(The backend's `util/topic-to-queue!` function is doing exactly this)</small>

We can also test it's working from the command line:

```sh
chemtrack-example$ lein cljs-lambda invoke topic-to-queue \
  '{"topic-name": "test-topic", "queue-name": "test-queue"}'
#  => {:queue-id "https://sqs.us-east-1.amazonaws.com...",
#      :topic-id "arn:aws:sns:us-east-1..."}
```

## Tying Up

Out of compassion, I resisted the impulse to further complicate the
example with features --- Dynamo persistence being the hardest to leave out
([because it would have been easy to sneak
in](https://github.com/nervous-systems/hildebrand/wiki/hildebrand.channeled#batching-puts)).

Please [let me know](/contact) if you have any questions.  The [demo repository](https://github.com/nervous-systems/chemtrack-example) may help to clarify points which were skipped over in excerpt.

### Image Credits

 - Rainbow contrails: <a href="http://bigamericannews.com/2015/03/22/confirmed-obama-increasing-chemtrail-missions-to-infect-males-with-homosexuality/">bigamericannews.com</a>
 - Big Bird: <a href="https://evidenceplease.files.wordpress.com/2014/12/282556_501364479894387_593164660_n.jpg">evidenceplease</a>
 - Horrific Bryce3D sephirot: <a href="http://www.spiritual-board.com/">spiritual-board.com</a>
 - Demo application background image: <a href="http://www.samuelheller.ch/wp-content/uploads/2012/10/608045_original_R_K_PeterFreitagPixelio.de_.jpg">samuelheller.ch</a>