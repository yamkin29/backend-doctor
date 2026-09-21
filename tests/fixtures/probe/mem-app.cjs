// Memory/GC fixture (spec 020): lives ~1s under allocation pressure so a
// small sampling interval yields several mem.sample events; minor GCs happen
// naturally under the pressure (asserted structurally, never on count).
let sink = [];
const timer = setInterval(() => {
	for (let i = 0; i < 5000; i++) sink.push(new Date(i));
	if (sink.length > 500000) sink = [];
}, 20);
setTimeout(() => {
	clearInterval(timer);
	console.log("mem-app-done");
}, 1000);
