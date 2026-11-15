// Copia los archivos de la web a "www" (funciona en Windows, Mac y Linux)
const fs = require("fs"), path = require("path");
const items = ["index.html","style.css","script.js","supabase.js","app-mobile.css","app-mobile.js","sw.js","manifest.webmanifest","icons","img"];
fs.rmSync("www", { recursive: true, force: true });
fs.mkdirSync("www");
for (const i of items) if (fs.existsSync(i)) fs.cpSync(i, path.join("www", i), { recursive: true });
console.log("www listo:", items.filter(fs.existsSync).join(", "));
