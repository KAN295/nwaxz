import { ESCAPE_TITLE } from "../src/escape/title.ts";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { BlockList } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { CoopService } from "./coop-service.mjs";
import { attachCoopSockets } from "./coop-socket.mjs";

const { values } = parseArgs({ options: { host: { type: "string" }, port: { type: "string", default: "5189" } } });
const privateAddress = new BlockList();
privateAddress.addSubnet("10.0.0.0", 8);
privateAddress.addSubnet("172.16.0.0", 12);
privateAddress.addSubnet("192.168.0.0", 16);
const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).filter(addr => addr.family === "IPv4" && !addr.internal && privateAddress.check(addr.address))
    .map(addr => ({ ...addr, name })));
const wifi = interfaces.filter(addr => /wi[- ]?fi|wlan|无线/i.test(addr.name));
const preferred = wifi.length === 1 ? wifi : interfaces;
const selected = values.host ? interfaces.find(addr => addr.address === values.host) : preferred.length === 1 ? preferred[0] : undefined;
if (!selected) {
  const addresses = interfaces.map(addr => `${addr.address} (${addr.name})`).join("、");
  throw new Error(addresses ? `请用 pnpm lan --host 指定同一网络的地址：${addresses}` : "未找到局域网 IPv4 地址，请先连接 Wi-Fi 或网线。");
}
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("端口必须为 1024–65535。");
const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(path.join(distDir, "index.html"))) throw new Error("请先运行 pnpm build 生成局域网游戏文件。");

const address = `${selected.address}:${port}`;
const subnet = new BlockList();
subnet.addSubnet(selected.address, Number(selected.cidr.split("/")[1]));
const allow = req => req.headers.host === address && !!req.socket.remoteAddress && subnet.check(req.socket.remoteAddress);
const service = new CoopService({ maxRooms: 8 });
const app = createApp({ distDir, coopService: service, lan: true });
const server = createServer((req, res) => {
  if (allow(req)) app(req, res);
  else res.writeHead(403).end();
});
attachCoopSockets(server, service, allow);
server.listen(port, selected.address, () => console.log(`局域网已开启。请在同一网络的浏览器打开 http://${address}/ ，再进入《${ESCAPE_TITLE}》 → 多人游戏。`));
const stop = () => {
  service.shutdown();
  app.locals.social.close();
  server.closeAllConnections();
  server.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
