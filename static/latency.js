function hierarchicalLatencyChart(){function j(w){w.value=w.average;if(w.children){for(var v=0;w.children&&v<w.children.length;v++){j(w.children[v])}}}function n(z,B,A,w,v){return"M"+z+","+B+"h"+(A-v)+"a"+v+","+v+" 0 0 1 "+v+","+v+"v"+(w-2*v)+"a"+v+","+v+" 0 0 1 "+-v+","+v+"h"+(v-A)+"z"}var l={top:30,right:30,bottom:0,left:130},q=700-l.left-l.right,m=360-l.top-l.bottom,h=d3.scale.linear().range([0,q]),f=35,r=d3.scale.ordinal().range(["#0096CC","#B2DFEF"]),k=d3.scale.ordinal().range(["#CCCAC4"]),p=d3.scale.ordinal().range(["red"]),t=30;function d(w,v){return(v==undefined?k:r)(w)}function a(v){return v.average}var b=new d3.layout.partition().value(a).sort(function(v,w){return w.measurements!=undefined?w.measurements-v.measurements:w.average-v.average});var e=d3.svg.axis().scale(h).tickFormat(function(w){return w+"ms"}).tickSize(0).ticks(5).orient("top");var o=d3.select("#latency-graph-container").append("svg").attr("width",q+l.left+l.right).attr("height",m+l.top+l.bottom).append("g").attr("transform","translate("+l.left+","+l.top+")");o.append("rect").attr("class","background").attr("width",q).attr("height",m).on("click",g);o.append("g").attr("class","x axis");o.append("g").attr("class","y axis").append("line").attr("y1","100%");var s=latencyData.hierarchical;b.nodes(s);j(s);h.domain([0,s.value+s.error]).nice();i(s,0);function i(B,x){if(!B.children||this.__transition__){return}h.domain([0,d3.max(B.children,function(D){return D.value+D.error})]).nice();var y=d3.event&&d3.event.altKey?7500:300,w=y/B.children.length;var v=o.selectAll(".enter").attr("class","exit");var A=u(B).attr("transform",c(x)).style("fill-opacity",0.000001);A.select("text").style("fill-opacity",0.000001);A.select("line").style("stroke-opacity",0.000001);A.select("rect").style("fill",function(D){return d(D.name,D.children)});o.selectAll(".x.axis").transition().duration(y).call(e);A.attr("transform",function(E,D){return"translate(0,"+f*D+")"});var z=A.transition().duration(y*2).style("fill-opacity",1);z.select("text").style("fill-opacity",1);z.select("line").style("stroke-opacity",1);z.select("rect").attr("width",function(D){return h(D.value)}).style("fill",function(D){return d(D.name,D.children)});var C=v.transition().duration(y).style("opacity",0.000001).remove();o.select(".background").data([B]).transition().duration(y);B.index=x}function g(A){if(!A.parent||this.__transition__){return}var x=d3.event&&d3.event.altKey?7500:300,w=x/A.children.length;h.domain([0,d3.max(A.parent.children,function(C){return C.value+C.error})]).nice();var v=o.selectAll(".enter").attr("class","exit");var z=u(A.parent).attr("transform",function(D,C){return"translate(0,"+f*C+")"}).style("opacity",0.000001);z.select("rect").style("fill",function(C){return d(C.name,C.children)});o.selectAll(".x.axis").transition().duration(x*2).call(e);var y=z.transition().duration(x*2).style("opacity",1);y.select("rect").attr("width",function(C){return h(C.value)}).each("end",function(C){if(C===A){d3.select(this).style("fill-opacity",null)}});var B=v.selectAll("g").transition().duration(x).delay(function(D,C){return C*w});B.select("text").style("fill-opacity",0.000001);B.select("line").style("stroke-opacity",0.000001);B.select("rect").style("fill-opacity",0.000001);v.transition().duration(x*2).remove();o.select(".background").data([A.parent]).transition().duration(x)}function u(x){var w=o.insert("g",".y.axis").attr("class","enter").attr("transform","translate(0,5)").selectAll("g").data(x.children).enter().append("g").style("cursor",function(y){return !y.children?null:"pointer"}).on("click",i);w.append("text").attr("x",-6).attr("y",t/2).attr("dy",".35em").style("text-anchor","end").text(function(y){return y.name});var v=w.append("rect").attr("width",function(y){return h(y.value)}).attr("fill",function(y){return d(y.value,y.children)}).attr("height",t);w.append("line").attr("x1",function(z){var y=z.value-z.error;return h(y<0?0:y)}).attr("y1",t/2).attr("x2",function(y){return h(y.value+y.error)}).attr("y2",t/2).attr("stroke",function(y){return p(y.value)}).attr("stroke-width",2);return w}function c(x){var v=[],w=0;return function(z){var y="translate("+w+","+t*x+")";w+=z.value;return y}}};function groupedLatencyGraph(e,f){margin={top:20,right:20,bottom:85,left:40},width=700-margin.left-margin.right,height=290-margin.top-margin.bottom;var d=d3.scale.ordinal().rangeRoundBands([0,width-10],0.2);var b=d3.scale.ordinal();var l=d3.scale.linear().range([height,0]);var c=d3.svg.axis().scale(d).ticks(0).tickSize(0).orient("bottom");var a=d3.svg.axis().scale(l).ticks(5).tickSize(0).tickFormat(function(q){return q+"ms"}).orient("left");var o=d3.tip().attr("class","d3-tip").offset([-10,0]).html(function(q){return q.manufacturer+", "+Math.round(q.value)+"ms / "+q.samples+" runs"});var h=d3.select(e).append("svg").attr("width",width+margin.left+margin.right).attr("height",height+margin.top+margin.bottom).append("g").attr("transform","translate("+margin.left+","+margin.top+")");h.call(o);var k=d3.scale.ordinal().range(["#B2DFEF","#0096CC"]);d.domain(f.map(function(q){return q.name}));var m=["4","5"];b.domain(m).rangeRoundBands([0,d.rangeBand()]);l.domain([0,d3.max(f,function(q){return d3.max(q.builds,function(r){return r.value})})]);h.append("g").attr("class","x axis").attr("transform","translate(0,"+height+")").call(c).selectAll("text").style("text-anchor","end").attr("dx","-.8em").attr("dy",".15em").attr("transform",function(q){return"rotate(-65)"});h.append("g").attr("class","y axis").call(a);var g=h.selectAll(".dev").data(f).enter().append("g").attr("class","g").attr("transform",function(q){return"translate("+d(q.name)+")"});g.selectAll("rect").data(function(q){return q.builds}).enter().append("rect").attr("fill",function(q){return k(q.name)}).attr("x",function(q){return b(q.name)}).attr("width",b.rangeBand()).attr("y",function(q){return l(q.value)}).attr("height",function(q){return height-l(q.value)}).on("mouseover",o.show).on("mouseout",o.hide);var p=d3.svg.area().x(function(q){return b(q.name)+b.rangeBand()/2}).y0(function(q){return l(q.value-q.error)}).y1(function(q){return l(q.value+q.error)}).interpolate("linear");var j=d3.scale.ordinal().range(["#E57FCA"]);var i=g.selectAll(".error").data(function(q){return q.builds});i.enter().append("path");i.attr("d",function(q){return p([q])}).attr("stroke","red").attr("stroke-width",1);var n=h.selectAll(".legend").data(["4","5"]).enter().append("g").attr("class","legend").attr("transform",function(r,q){return"translate(0,"+q*16+")"});n.append("rect").attr("x",width-12).attr("width",12).attr("height",12).style("fill",k);n.append("text").attr("x",width-18).attr("y",6).attr("dy",".35em").style("text-anchor","end").text(function(q){return"Android "+q})};function latencyGraph(d,f){var e={top:20,right:20,bottom:30,left:50},b=700-e.left-e.right,o=200-e.top-e.bottom;var n=d3.scale.ordinal().rangeBands([0,b],0.2);var m=d3.scale.linear().range([o,0]);var c=d3.svg.axis().tickSize(0).scale(n).orient("bottom");var a=d3.svg.axis().scale(m).tickSize(0).tickFormat(function(r){return r+"ms"}).orient("left");var k=d3.scale.ordinal().range(["#0096CC","#B2DFEF"]);var i=d3.scale.ordinal().range(["red"]);var q=d3.svg.line().x(function(r){return n(r.name)}).y(function(r){return m(r.value)});var g=d3.select(d).append("svg").attr("width",b+e.left+e.right).attr("height",o+e.top+e.bottom).append("g").attr("transform","translate("+e.left+","+e.top+")");n.domain(f.map(function(r){return r.name}));var l=d3.max(f,function(r){return r.value+r.error});m.domain([0,l]);a.ticks(5);g.append("g").attr("class","x axis").attr("transform","translate(0,"+o+")").call(c);g.append("g").attr("class","y axis").call(a);var j=g.selectAll("rect").data(f).enter().append("rect").attr("x",function(r){return n(r.name)}).attr("y",function(r){return m(r.value)}).attr("height",function(r){return o-m(r.value)}).attr("width",n.rangeBand()).attr("fill",function(r){return k(r.name)});var p=d3.svg.area().x(function(r){return n(r.name)+n.rangeBand()/2}).y0(function(r){return m(r.value-r.error)}).y1(function(r){return m(r.value+r.error)}).interpolate("linear");var h=g.selectAll(".error").data(f);h.enter().append("path");h.attr("d",function(r){return p([r])}).attr("stroke","red").attr("stroke-width",2)};
