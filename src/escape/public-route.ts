export const PUBLIC_GAME_ORIGIN = 'https://nwaxz.bzlom.cn';
export const PUBLIC_ROUTES = [
  {id:'direct', name:'奶娃月泉', label:'直连', host:'play.bzlom.cn'},
  {id:'primary', name:'奶娃浴场', label:'主站', host:'nwaxz.bzlom.cn'},
] as const;
export type PublicRouteId = typeof PUBLIC_ROUTES[number]['id'];
export type RouteLatencies = Partial<Record<PublicRouteId, number | null>>;
export const HIGH_LATENCY_MS = 250;

/** Time only the application echo. DNS, TLS and the WebSocket upgrade finish before this timer starts. */
export async function measureRoomRoute(host:string):Promise<number|null> {
  let latency=0;
  try {
    const socket=await firstReadyRoomSocket([new URL(`wss://${host}/api/coop/AAAAAA/socket`)],new AbortController().signal,ms=>{latency=ms;});
    socket.close();
    return latency;
  } catch { return null; }
}

/** Race an application round trip on each open socket before handing either one a room token. */
export function firstReadyRoomSocket(routes: URL[], signal: AbortSignal, measured?:(latency:number)=>void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const candidates = new Set<WebSocket>();
    let settled = false;
    function finish(winner?: WebSocket) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      for (const ws of candidates) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        if (ws !== winner) ws.close();
      }
      if (winner) resolve(winner);
      else reject(new Error('联机线路暂时不可用'));
    }
    function cancel() { finish(); }
    const timeout = setTimeout(cancel, 6500);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, {once:true});
    for (const route of routes) {
      let ws: WebSocket;
      try { ws = new WebSocket(route); } catch { continue; }
      candidates.add(ws);
      let sentAt=0;
      ws.onopen = () => {sentAt=performance.now();ws.send('{"type":"probe"}');};
      ws.onmessage = e => {
        try { if (JSON.parse(e.data)?.type === 'route-ready') { measured?.(Math.round(performance.now()-sentAt));finish(ws); return; } } catch { /* unusable endpoint */ }
        ws.close();
      };
      ws.onclose = () => {
        candidates.delete(ws);
        if (!candidates.size) finish();
      };
    }
    if (!candidates.size) finish();
  });
}
