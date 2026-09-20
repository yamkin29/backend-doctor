if (globalThis.__bdMergeSentinel !== true) {
	console.log("merge-missing");
	process.exit(1);
}
console.log("merge-ok");
