---
layout: post
title: Python Data Deployment on AWS Lambda
summary: Perfunctory tutorial on deploying 3rd party native libs (scipy/numpy/pandas) to AWS Lambda.
author: Moe Aboulkheir
categories: python aws lambda
tags: lambda aws python
date: 2016-02-17 00:50:00
---

## Background

This took longer than I'd be comfortable admitting.  The _idea_ was to extract
portions of a data analysis pipeline from an [IPython](http://ipython.org/)
Notebook and have them be invokable on
[Lambda](http://docs.aws.amazon.com/lambda/latest/dg/welcome.html).  The
dependencies involved are common enough ([scipy](http://www.scipy.org/)/numpy &
[pandas](http://pandas.pydata.org/)) that I'd imagine at least one other person
will have to go through this.

My [Lambda experience has been confined to
Clojurescript](https://github.com/nervous-systems/cljs-lambda)/Java, and I
haven't written more than a couple of lines of Python in a few years --- shield
the eyes, steady the stomach, etc.

## Goal

We want to end up with a repeatable process for producing a substantial (~50MB)
zip file containing all of the dependencies of our handler --- including any
shared libraries.

As the first/only opportunity we're given to adjust the execution context of our
Lambda-deployed code is in a Python function (with no opportunity to set
environment variables upfront), our handler'll be spawning a Python subprocess
with a modified load path before executing any application-specific code.

### Build Steps
#### Setup / Once-off
- Generate "template" zip file containing third-party deps, etc. on Amazon Linux EC2 instance (`deps.zip`, let's say)
- Upload zip to S3 bucket (Similarly, `my-bucket`)

#### Deploy Application Code
- Download `deps.zip` from `my-bucket`
- Add application-specific code to zip file (incl. subprocess harness)
- Deploy to S3<sup>1</sup>
- Deploy to Lambda

<div class="footnote"><sup>1</sup> <small>In this case, our zip file is going to exceed Lambda's 50MB direct-upload limit, so we're required to deploy from S3.</small></div>

There are other ways this could be done, e.g. zipping environment on
development/build machines and adding pre-built shared libraries prior to Lambda
deployment / static compilation from source, etc. --- adjust as needed.

# Code Dump

## Accumulating Runtime Dependencies

[virtualenv](https://virtualenv.readthedocs.org/en/latest/) is probably the
right way to do this.

To maximize the chances of success, I threw some [dogecoin](http://dogecoin.com/)
at a `t2.medium` instance running
[ami-60b6c60a](http://docs.aws.amazon.com/lambda/latest/dg/current-supported-versions.html),
the image used by US East AWS Lambda machines.

### build-base-env.sh
```shell
#!/usr/bin/env bash

set -e -o pipefail

sudo yum -y upgrade
sudo yum -y groupinstall "Development Tools"
sudo yum -y install blas blas-devel lapack \
     lapack-devel Cython --enablerepo=epel

virtualenv ~/env && cd ~/env && source bin/activate
pip install numpy
pip install scipy
pip install pandas
for dir in lib64/python2.7/site-packages \
             lib/python2.7/site-packages
do
  if [ -d $dir ] ; then
    pushd $dir; zip -r ~/deps.zip .; popd
  fi
done
mkdir -p local/lib
cp /usr/lib64/liblapack.so.3 \
   /usr/lib64/libblas.so.3 \
   /usr/lib64/libgfortran.so.3 \
   /usr/lib64/libquadmath.so.0 \
   local/lib/
zip -r ~/deps.zip local/lib
```

<ul class="dir-layout">
  <li>scipy/
    <ul><li>...</li></ul>
  </li>
    <li>pandas/
    <ul><li>...</li></ul>
  </li>
  <li>local/
    <ul>
      <li>lib/
        <ul>
          <li>libblas.so.3</li>
          <li>liblapack.so.3</li>
        </ul>
      </li>
    </ul>
  </li>
</ul>

(After building `deps.zip`, I'm imagining something like `aws s3 cp ~/deps.zip
s3://my-bucket/`)

The idea is to end up with all of the Python package dependencies crammed at the
top-level (i.e. accessible via naive imports in our application code), and the
shared libraries in a `local/lib` directory which we'll take
responsibility for loading once our entrypoint is invoked.

I'm not claiming this is an exhaustive list of the shared objects you'll need,
only the minimal set to do any work.

## Adjusting Runtime Environment

Our Lambda function's handler is going to be running in a Python process which
doesn't have access to, e.g. `libblas`, etc. --- that's going to be a problem.
Here's one approach:

### handlers.py

```python
import os, sys, subprocess, json

LIBS = os.path.join(os.getcwd(), 'local', 'lib')

def handler(filename):
    def handle(event, context):
        env = os.environ.copy()
        env.update(LD_LIBRARY_PATH=LIBS)
        proc = subprocess.Popen(
            ('python', filename),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT)
        (stdout, _) = proc.communicate(input=json.dumps(event))
        try:
            return json.loads(stdout)
        except ValueError:
            raise ValueError(stdout)
    return handle

def invoking(f):
    output = f(json.load(sys.stdin))
    json.dump(output, sys.stdout)

my_function = handler('my_function.py')
other_function = handler('other_function.py')
```

### my_function.py

```python
import handlers, pandas

def my_function(n):
    return (n * 2, pandas.__version__)

if __name__ == '__main__':
    handlers.invoking(my_function)
````

If `handlers.my_function` is specified as the handler for a Lambda function, and then invoked:

- `handlers.my_function` (a `handler` wrapper) executes `LD_LIBRARY_PATH=local/lib python my_function.py`
- Some JSON representing the Lambda input (a number, in this case) is written to the child's `stdin`
- In the `my_function.py` child process, `handlers.invoking` reads the JSON from stdin, and passes its data representation to `my_function`
- The result is serialized to JSON and written to stdout by `handlers.invoking`
- `handler` (parent process) conveys this back to the Lambda caller

This obviously isn't the be-all of inter-process communication --- there are _so
many_ fancier ways this could be done. Logging, better error handling, package
structure etc. can come later.

## Deployment

(`deps.zip` being the output of our first step.)

```shell
$ aws s3 cp s3://my-bucket/deps.zip latest.zip
$ zip latest.zip handlers.py my_function.py
$ aws s3 cp latest.zip s3://my-bucket/
$ aws lambda create-function \
       --function-name my-function \
       --runtime python2.7 \
       --handler handlers.my_function \
       --role exquisite-role
$ aws lambda update-function-code \
       --function-name my-function \
       --s3-bucket my-bucket \
       --s3-key latest.zip
```

## Invocation

Invoking `my-function`, with, say, `2` ought to yield something like:

`[4, '0.17.1']`

--- a trivial example hopefully demonstrating that `pandas` can be
successfully imported, and that multiplication remains possible.
