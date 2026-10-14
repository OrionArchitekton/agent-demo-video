// stand-in hyperframes CLI: exits 0 but logs a hard error
console.log("rendering...");
console.error("PAGEERROR boom");
process.exit(0);
