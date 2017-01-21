---
layout:     post
title:      Introducing Hildebrand
date:       2015-06-01 11:21:29
summary:    An asynchronous Clojure client for Amazon's DynamoDB service.
author:     Moe Aboulkheir
categories: clojure aws dynamo hildebrand
tags: clojure aws dynamo hildebrand
redirect_from: /clojure/aws/dynamo/hildebrand/2015/06/08/hildebrand/
gh: hildebrand
---

## Motivation

I have spent much of my time as a computer programmer scraping blind in the
dust. Now I recline, keenly sighted, on furniture of criminal opulence.
This is a development I'm eager to share with you.

If brevity is the soul of wit, diagrams are its throbbing sacral chakra:

![Kurzweil](https://nervous.io/images/graph.png)

## Approach

For the rest of the post, we'll be role-playing as developers at a well
intentioned startup.  Our focus is an application which uses personality markers
to provide deeply personal curry<sup>1</sup> suggestions.  Through dextrous use of
associative data structures, our company is to play a significant, but
inadvertent role in the emergence of sentient computer programs.  This is a
mobile-friendly blog: in a nod to compactness, we'll skirt around those details
and constrain our explorations to the curry-specific.

It's development day one.  Our team of researchers have catalogued thousands of
dishes, alongside conflicting/incomplete indexical data, and we need a place to
hide them.

<div class="footnote"><sup>1</sup> <small>Actual, edible curry</small></div>

## Setup

([Hildebrand is available on Github](
https://github.com/nervous-systems/hildebrand))

Let's create a table which will allow us to retrieve curries by name, and
efficiently locate curries by spiciness within geographical regions.  Our curry
finding startup is self-funded, so we're going to be conservative with the
throughput requirements for now.

```clojure
(hildebrand/create-table!
 creds
 {:table :curries
  :throughput {:read 1 :write 1}
  :attrs {:name :string :region :string :spiciness :number}
  :keys  [:name]
  :indexes {:global
            [{:name :curries-by-region-spiciness
              :keys [:region :spiciness]
              :project [:all]
              :throughput {:read 1 :write 1}}]}})
```

(The relevant bits are the declaration that `:name` is to be the identifying
attribute when querying the table, and when querying the helpfully-named index,
we'll use some combination of `:region` and `:spiciness`)

The above invocation will return a
[core.async](https://github.com/clojure/core.async) channel, from which, after a
comforting delay, we'll be able to read an expanded table description in a
familiar format: the colon-riddled mass.

```clojure
{:table :curries
 :attrs {:name :string, :region :string}
 :keys [:region :name]
 :items 0
 :size 0
 :status :creating
 ...}
```

Taking a step back, it seems to me the popularity of blocking I/O is evidence of
a widespread philosophical unwholesomeness.  It's the sort of habit likely to
invite casual incineration when the extra-terrestrials reveal themselves.

Your Best Self almost certainly doesn't block on network requests, is what I'm
saying.  Hildebrand was designed as an asynchronous library, and doesn't block
internally. For desperate moments, there is a fully-featured blocking API.

It's Clojure all the way down - communication with AWS is done using a client
library built on [httpkit](http://www.http-kit.org/).

## Insertion & Retrieval

```clojure
(hildebrand/put-item!
 creds
 :curries
 {:name "Jalfrezi"
  :region "Pakistan"
  :spiciness 4
  :allergens #{"clove" "cinnamon"}
  :ingredients {"onion" 2 "tomato" 3 "chili" 2}})
```

Considering the gravity of the undertaking, a single exclamation mark doesn't
seem enough.  Let's up the tension by using the the double-bang (or, _overkill_)
version of `get-item` to synchronously retrieve the Jalfrezi map:

```clojure
>>> (hildebrand/get-item!! creds :curry {:name "Jalfrezi"})

{:name "Jalfrezi",
 :region "Pakistan",
 :spiciness 4N,
 :allergens #{:clove :cinnamon},
 :ingredients {:tomato 3N, :onion 2N, :chili 2N}}

;; Note map keys and string set members are keyworded.
;; Most of the time this ought to be useful.
```

Here, imagine a sequence of thousands of operations similar to the above,
executed with an undiminishing sense of wonder and accomplishment.

## Querying

```clojure
(hildebrand.page/query!
 creds
 :curries
 {:region [:= "Pakistan"] :spiciness [:< 5]}
 {:index :curries-by-region-spiciness
  :limit 10})
```

`query!` will give us a result channel onto which individual items are
placed.  Channel consumption will trigger further retrievals, in groups of ten
as per the `:limit`.

If we're unsatisfied with the results, we can re-perform the query with
Dynamo-side filtering, by adding a `:filter` key to the final argument map:

```clojure
{:filter [:and [:exists [:ingredients :onion]]
          [:not [:contains [:allergens] "cinnamon"]]]}
```

A goal for the Hildebrand API is to have requests, as pieces of data, be
represented naturally enough that it's unnecessary to hide their construction
behind macros, or to curtail the more advanced features of Dynamo because of
representational awkwardnesses.  Though it looks a little prosthetic, I've
convinced myself the general approach is the least-worst of the availabile
options.

## Updating

I know, but it happens.

Individual update operations are expressed as leaves in a nested map which
parallels the structure of the item:

```clojure
;; Invocation pattern
(hildebrand/update-item!
 creds :curries {:name "Jalfrezi"} <update map>)

;; Update map for top-level attribute
{:delicious [:init true]} ;; Set if attr doesn't exist

;; Update map for nested attribute
{:ingredients {:onion [:inc 4]}}
```

The leaves are always vectors/variants describing an action, and sometimes
supplying companion values.  Here's a complete example, with a precondition:

```clojure
(hildebrand/update-item!
 creds
 :curries
 {:name "Jalfrezi"}
 {:ingredients {:onion [:inc 4] :tomato [:remove]}
  :allergens   [:concat #{"mustard" "nuts"}]
  :delicious   [:init true]}
 {:when [:and
          [:< [:ingredients :onion] [:ingredients :tomato]]
          [:contains [:allergens] "clove"]]})
```

The syntax of `:when` is identical to `:filter` in the query example above.

Note that items can be overwritten freely in Dynamo using `put-item!` -
 updates are intended specifically for adjustments.

## Errors

Hildebrand takes the approach of placing `Exception` instances on the channels
returned by the above functions.  This approach is described elsewhere by
[Martin
Trojer](http://martintrojer.github.io/clojure/2014/03/09/working-with-coreasync-exceptions-in-go-blocks/)
and [David
Nolen](http://swannodette.github.io/2013/08/31/asynchronous-error-handling/).

Rather than using a type hierarchy for exceptions, `ExceptionInfo` objects are
used.  With something like [Slingshot](https://github.com/scgilardi/slingshot),
you'd have a pretty jazzy way of figuring out what's happening. Here's an
example of tying this together:

```clojure
(go
  (try+
    (<? (hildebrand/put-item!
         creds
         :curries
         {:name "Jalfrezi" ...}
         {:when [:not-exists :name]}))
    (catch [:type :conditional-failed] _
      nil)
    ...))
```

(Slingshot is optional, there are other ways to do this).

Note that it's possible that errors are placed on channels conveying multiple
values, e.g. when performing paged queries.  Pervasive use of error-aware
channel reads is recommended for all library interactions.

## Wrapping Up

### Lower Level Stuff

The underlying AWS communication is implemented in a distinct library called
[eulalie](https://github.com/nervous-systems/eulalie).

The retry/backoff, signing, etc. logic is intended to behave identically to the
official AWS client.  One notable exception is proxied requests, which are
unsupported due to lack of proxy support in httpkit.

### Going Forward

Please see the [Hildebrand Github
issues](https://github.com/nervous-systems/hildebrand/issues), and the [ones for
eulalie](https://github.com/nervous-systems/eulalie/issues) if you would like to
help out, or want to get an idea of what's missing.
