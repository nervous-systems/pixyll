---
layout:     post
date:       2016-03-28 11:33:00
title:      Slack Commands in Clojurescript
summary:    We'll do anything for a bag lunch and a place to whine.
author:     Moe Aboulkheir
categories: clojure clojurescript aws
tags: clojure clojurescript slack aws lambda
---

# Introduction

As a standalone Clojurescript/AWS Lambda function example, we're going to walk
through a Slack [Slash Command](https://api.slack.com/slash-commands) exposed via [API
Gateway](https://aws.amazon.com/api-gateway/).

Lambda, [as covered
previously](/clojure/clojurescript/aws/lambda/node/lein/2015/07/05/lambda/) will
allow us to deploy compiled Clojurescript code and invoke it, without worrying
about exactly where it gets run.  API Gateway allows HTTP endpoints to be
associated with AWS service triggers --- including the invocation of Lambda
functions.

<div class="infobox">
<p>
I've published a <a href="https://github.com/nervous-systems/cljs-lambda-slack-command">simple Leiningen template</a>:
</p>
<p><code>lein new cljs-lambda-slack-command example</code></p>
<p>
...which generates an echo function and (more substantially) a horrific shell script which can be used to set up an API Gateway.
</p>
</div>

Disregarding your interest in Slack, the machinery we're using affords us the
ability to expose dynamically scaling, server-side Clojurescript via AWS-managed
HTTP endpoints --- without managing instances or requiring any knowledge of HTTP
(or API Gateway) within the Clojurescript itself.  Which is pretty cool.

## Crash Course

Slack can be configured to make HTTP requests which are trigged by
slash-prefixed commands: in a chat, a user types ` /trigger text`, and some
user-defined URL associated with `trigger` receives `text`.  A response may be
issued to the invoking user, or the channel the command was issued in.

If Slack's HTTP request doesn't complete within 3 seconds (or 3,000
milliseconds, as the documentation insists), the user gets a timeout
message. The incoming request has a URL associated with it, which'll accept
messages via POST over a longer period.

# Approach

We're not going to be able to do much computer science in 3,000 milliseconds ---
our Slack-facing function asynchronously<sup>1</sup> invokes another Lambda
function, passing it the command's input text and the response callback URL.
The outer function will respond to the user with a helpful status message as
soon as it's handed off the information.

<div class="footnote"><sup>1</sup> <small>Using Lambda's <code>event</code> invocation type --- we don't care about the response, and can't afford to wait for it.</small></div>

The second function does its best to open a portal to hell: it takes the user's input string, searches for some related YouTube videos, and posts a comment from one of them into the channel via the callback URL.

Here it is, echoing the despair of my Greek Chorus:

<img src="/static/yt-eliza.jpg">


# Code Dump

The project we're talking about exists on Github as [youtube-eliza](https://github.com/nervous-systems/youtube-eliza), and is partially reproduced below, alongside riveting commentary.

## Project Layout

<ul class="dir-layout">
<li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/project.clj">project.clj</a></li>
<li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/static/config.edn">static/config.edn</a></li>
<li>src/yt_eliza/
  <ul>
    <li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/handlers.cljs">handlers.cljs</a></li>
    <li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/core.cljc">core.cljc</a></li>
     <li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/util.cljc">util.cljc</a></li>
     <li><a href="https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/youtube.cljc">youtube.cljc</a></li>
  </ul>
</li>
</ul>

To simplify testing & REPL interactions, we're implementing much of the functionality in `cljc` files, with a single `cljs` file holding the two Lambda handlers ([cljs-lambda](https://github.com/nervous-systems/cljs-lambda) --- used in that namespace --- doesn't expose Clojure-compatible functionality).

As far as libraries, we're using:

<ul style="list-style-type: none" class="commentary">
<li><a href="https://github.com/nervous-systems/kvlt"><code>kvlt&nbsp;&nbsp;&nbsp;</code></a>  - <small>Node/browser/JVM HTTP & websocket client.</small></li>
<li><a href="https://github.com/nervous-systems/eulalie"><code>eulalie</code></a> - <small>AWS client library.  Low-level, exposes some Lambda-related utilities.</small></li>
<li><a href="https://github.com/funcool/promesa"><code>promesa</code></a> - <small>Provides as consistent Promise API, using completable futures or <a href="http://bluebirdjs.com/docs/getting-started.html">Bluebird</a></small></li>
</ul>

The font size gets smaller now.  Imagine a conspiratorial rasp.

## [project.clj](https://github.com/nervous-systems/youtube-eliza/blob/master/project.clj)

<small class="commentary">Below's the `:cljs-lambda` section of the project file, which superintends the deployment of our two Lambda functions. For each function, `:name` points at the identifers used within Lambda's API, and `:invoke` associates a Clojurescript function with the identifier.</small>

```clojure
{:defaults      {:role "arn:aws:iam..."}
 :resource-dirs ["static"]
 :functions
 [{:name       "yt-eliza"
   :invoke      yt-eliza.handlers/yt-eliza
   :timeout     20}
  {:name        "yt-eliza-gateway"
   :invoke      yt-eliza.handlers/yt-eliza-gateway
   :memory-size 512}]}
```

<small class="commentary"></small>
<small class="commentary">
The requested memory size is the only means we have of affecting the available CPU on the execution instances --- we give `yt-eliza-gateway` (the endpoint accessed by Slack) a little more juice, so we don't timeout.</small>
<small class="commentary">
<code>lein cljs-lambda deploy</code> will compile the project using its <a href="https://github.com/emezeske/lein-cljsbuild">cljsbuild</a> declaration, smash it into a zip file & hand that over to Lambda.  The cljsbuild entry specifies `:advanced` optimizations, as we're concerned with startup time.
</small>

## [static/config.edn](https://github.com/nervous-systems/youtube-eliza/blob/master/static/config.edn)

```clojure
{:slack-token "u4Up..."
 :youtube-key "AIza..."
 :not-found-response  {:text "Nothing found :cry:"}
 :processing-response {:text "Processing :crystal_ball:"}}
```

## [handlers.cljs](https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/handlers.cljs)

<small class="commentary">The Slack-facing Lambda handler:</small>

```clojure
(deflambda yt-eliza-gateway "Slack command entrypoint"
  [{:keys [token text response_url] :as input} ctx]
  (when (not= token (config :slack-token))
    (throw (ex-info "Unauthorized" {:type :bad-token})))
  (let [event {:query text :url response_url}]
    (go
      (<! (eulalie.lambda.util/invoke!
           (eulalie.creds/env) "yt-eliza" :event event))
      (config :processing-response))))
```

<small class="commentary">
We assume API Gateway's configured to turn the
`x-www-form-urlencoded` body of Slack's `POST` into a JSON object, with the
names untouched --- a task accomplished by [this super-ugly,
but generic
template](https://github.com/nervous-systems/youtube-eliza/blob/master/assets/slack-post.ftl).  cljs-lambda takes care of turning the input JSON into a
Clojurescript data structure & passing it into the above function.
</small>

<img src="/static/yt-eliza-2.jpg" />

<small class="commentary">To accommodate the channel returned by Eulalie, this handler's using core.async to signify completion, rather than a promise, as below.  Mostly, we'll be using promises, as we're dealing with single values and want unambiguous error semantics.
</small>

<small class="commentary">The `invoke!` call will park until Lambda accepts the invocation, but won't wait on its response.  "yt-eliza" is the deployed name of the function which appears below:</small>

<small class="commentary"><b>N.B.</b> For the above to work, <code>yt-eliza-gateway</code> must be deployed/executing under a role which permits invocation of <code>yt-eliza</code>.</small>

```clojure
(deflambda yt-eliza
  "Asynchronously invoked, handles command responses"
  [{:keys [query url]} ctx]
  (alet [videos   (p/await (yt/video-search!   youtube-key query))
         comment  (p/await (core/find-comment! youtube-key videos))
         body     (if comment
                    (core/comment->channel-response query comment)
                    (config :not-found-response))]
    (kvlt/request!
     {:method :post
      :url    url
      :type   :json
      :form   (tidy-response body)})))
```

<small class="commentary">
`alet` is a Promise-returning macro, allowing code to be written in a similar style to ES7's async/await.  We're fixing to:

<ol class="commentary">
  <li>Retrieve a sequence of identifiers for YouTube videos related to <code>query</code>
  <li>Work through those videos, looking for a suitable comment</li>
  <li>Default to a config-specified value, if not</li>
  <li>Make a <code>POST</code> request to the `url` input, passing a map which'll be converted into Slack-comprehensible JSON</li>
</ol>

## [youtube.cljc](https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/youtube.cljc)

```clojure
(defn youtube! [api-key url-parts query
                & [{:keys [limit] :or {limit 10}}]]
  (p/then
    (kvlt/request! {:url   (youtube-url url-parts)
                    :as    :json
                    :query (merge
                            {:maxResults limit
                             :part       "snippet"
                             :key        api-key}
                            query)})
    :body))

(defn video-search!
  [api-key search-term & [{:keys [limit] :or {limit 5}}]]
  (alet [{items :items}
         (p/await (youtube! api-key [:search]
                   {:q search-term :type "video"}))]
    (for [{:keys [id]} items]
      (id :videoId))))

(defn ->comment [m]
  (when-let [snippet (some-> m :snippet :topLevelComment :snippet)]
    {:text   (snippet :textDisplay)
     :author {:name   (snippet :authorDisplayName)
              :avatar (snippet :authorProfileImageUrl)}}))

(defn video-comments!
  [api-key video-id & [{:keys [limit] :or {limit 5}}]]
  (alet [{items :items}
         (p/await (youtube! api-key [:commentThreads]
                   {:videoId video-id}))]
    (keep ->comment items)))
```

## [core.cljc](https://github.com/nervous-systems/youtube-eliza/blob/master/src/yt_eliza/core.cljc)

```clojure
(defn find-comment! [api-key [video & videos]]
  (when video
    (alet [comments (p/await (yt/video-comments! api-key video))
           filtered (for [c comments
                          :when (not (contains-html? (c :text)))]
                      c)]
      (or (util/weighted-choice
           (zipmap filtered (map score-comment filtered)))
          (find-comment! api-key videos)))))
```

<small class="commentary">
It's conceivable we'd find a video or two without any easily-rendered comments --- above, we take in a sequence of video identifiers, and move onto the next if we don't find a suitable comments associated w/ the first.  Note that the apparently recursive `find-comment!` call is executed as a callback of the asynchronous `yt/video-comments!` invocation.
</small>

<small class="commentary">
<code>(count (comment :text))</code> was the best I could do for <code>score-comment</code>.
</small>

# Deploying

The intention above was more to demonstrate a viable example than release a piece of software, though the [example repository](https://github.com/nervous-systems/youtube-eliza/) ought to be deployable without too much headache.

After adjusting the `:role` in `project.clj` & deploying the Lambda functions, run the
[create-api.sh](https://github.com/nervous-systems/youtube-eliza/blob/master/create-api.sh)
script at the root of the repository:

```bash
$ lein cljs-lambda deploy
...
$ ./create-api.sh [--profile default]
...
url https://opaque-id.execute-api.region.amazonaws.com/auto
```

The resulting URL is suitable for feeding to Slack:
<p />

<img src="/static/slack.png" />

After `create-api.sh` has executed once, successive cljs-lambda `deploy` invocations
will update the function pointed to by the API endpoint.  Running
`create-api.sh` multiple times will create multiple parallel APIs, which may not
be what you want.

# Shortcomings

For expendience, both functions are defined in the same source file, despite `yt-eliza-gateway`'s dependence on fewer external libraries --- this means we're unnecessarily penalized at runtime.

While cljs-lambda doesn't currently allow per-function build specs, in a real-world scenario we could easily work around this limitation using a Leiningen profile:


```clojure
:profiles {:gateway {:cljs-lambda
                     {:cljs-build-id "gateway-build-id"}}}
```

Assuming "gateway-build-id" specifies `:advanced` optimizations and
`yt-eliza-gateway` is defined in a module which doesn't `:require` anything
unnecessary:

```bash
$ lein with-profile gateway cljs-lambda deploy yt-eliza-gateway
```

# Finishing Up

If you'd like to mess around with your own Slack commands:

```bash
$ lein new cljs-lambda-slack-command example
````
