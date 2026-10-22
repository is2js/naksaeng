import { createServer } from "vite";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const host = option("--host", "127.0.0.1");
const port = Number(option("--port", "5174"));
if (!Number.isInteger(port) || port < 1024 || port > 65534) {
  throw new Error("개발 포트는 1024~65534 범위여야 합니다. 다음 포트도 내부 앱 서버에 사용합니다.");
}

const app = await createServer({
  configFile: "vite.config.ts",
  server: { host, port: port + 1, strictPort: true },
});
let district;
try {
  await app.listen();
  district = await createServer({
    configFile: "vite.district.config.ts",
    server: {
      host, port, strictPort: true,
      proxy: {
        "/naksaeng/bunfirvil": { target: `http://${host}:${port + 1}`, ws: true },
      },
    },
  });
  await district.listen();
} catch (error) {
  await app.close();
  throw error;
}

console.log(`\n낙생지구: http://${host}:${port}/naksaeng/`);
console.log(`A1 놀이터: http://${host}:${port}/naksaeng/bunfirvil/\n`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all([district.close(), app.close()]);
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
