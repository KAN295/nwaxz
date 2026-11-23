/** Race an application round trip on each open socket before handing either one a room token. */
export function firstReadyRoomSocket(routes: URL[], signal: AbortSignal): Promise<WebSocket> {
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
      ws.onopen = () => ws.send('{"type":"probe"}');
      ws.onmessage = e => {
        try { if (JSON.parse(e.data)?.type === 'route-ready') { finish(ws); return; } } catch { /* unusable endpoint */ }
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
