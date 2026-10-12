"""Optional local two-browser integration test using mock encrypted-signal transport.
Run: python tests/browser_integration.py  (needs playwright + chromium + websockets)
Does not test live Firebase security rules, mobile OS media permissions, or TURN.
"""
import asyncio
import json
import pathlib
import socket
import subprocess
import time

import websockets
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOCK_SIGNAL = """
export const configured = true;
export async function connectSignaling(roomId, {onRole, onPeer, onEncryptedSignal, onDisconnectError}) {
 const socket = new WebSocket('ws://127.0.0.1:18575');
 let role;
 await new Promise((resolve,reject) => {
  socket.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type==='role') {role=m.role;onRole(role);resolve();}
    else if (m.type==='peer') onPeer(m.joined);
    else if (m.type==='signal') onEncryptedSignal(m.payload);
  };
  socket.onopen=()=>socket.send(JSON.stringify({type:'join',roomId}));
  socket.onerror=()=>reject(new Error('test socket failed'));
 });
 return {role, send: async payload => {socket.send(JSON.stringify({type:'signal',payload}));}, close: async () => socket.close()};
}
"""

async def main():
    groups = {}
    async def serve_ws(ws):
        room = None
        try:
            async for raw in ws:
                data = json.loads(raw)
                if data['type'] == 'join':
                    room = data['roomId']; occupants = groups.setdefault(room, [])
                    if len(occupants) >= 2:
                        await ws.close(); return
                    role = ['host','guest'][len(occupants)]
                    occupants.append(ws)
                    await ws.send(json.dumps({'type':'role','role':role}))
                    if len(occupants) == 2:
                        for other in occupants:
                            await other.send(json.dumps({'type':'peer','joined':True}))
                elif data['type']=='signal' and room:
                    for other in list(groups.get(room,[])):
                        if other != ws:
                            await other.send(json.dumps({'type':'signal','payload':data['payload']}))
        finally:
            if room in groups and ws in groups[room]:
                groups[room].remove(ws)
                for other in groups[room]:
                    await other.send(json.dumps({'type':'peer','joined':False}))
    with subprocess.Popen(['python','-m','http.server','18574','--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) as http:
      async with websockets.serve(serve_ws,'127.0.0.1',18575):
        async with async_playwright() as p:
          browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'])
          contexts=[]
          try:
            for i in range(2):
              ctx=await browser.new_context(permissions=['camera','microphone'])
              contexts.append(ctx)
              await ctx.route('**/firebase-signal.js',lambda route:route.fulfill(status=200,body=MOCK_SIGNAL,content_type='text/javascript'))
            a=await contexts[0].new_page(); b=await contexts[1].new_page()
            logs=[]
            for name,page in [('A',a),('B',b)]:
              page.on('console',lambda m,name=name:logs.append((name,'console',m.text)))
              page.on('pageerror',lambda e,name=name:logs.append((name,'error',str(e))))
            print('Loading A',flush=True); await a.goto('http://127.0.0.1:18574',wait_until='domcontentloaded',timeout=15000)
            print('Creating room',flush=True); await a.click('#createBtn',timeout=10000)
            await a.wait_for_timeout(1000)
            url=a.url
            print('Room URL secret created:',url.split('#')[0]+'#(redacted)')
            print('Loading B',flush=True); await b.goto(url,wait_until='domcontentloaded',timeout=15000)
            print('Waiting for handshake',flush=True); await a.locator('#safetyNumber').wait_for(state='visible',timeout=15000)
            await a.wait_for_function('document.querySelector("#safetyNumber").textContent.includes(" ")',timeout=20000)
            await b.wait_for_function('document.querySelector("#safetyNumber").textContent.includes(" ")',timeout=20000)
            code_a=await a.locator('#safetyNumber').text_content()
            code_b=await b.locator('#safetyNumber').text_content()
            assert code_a == code_b and 'CONNECTING' not in code_a,(code_a,code_b)
            print('PASS: WebRTC channel opened, identities signed, safety numbers match')
            await a.click('#verifyBtn'); await b.click('#verifyBtn')
            await a.wait_for_function('!document.querySelector("#sendBtn").disabled',timeout=15000)
            await b.wait_for_function('!document.querySelector("#sendBtn").disabled',timeout=15000)
            await a.fill('#messageInput','Test E2EE hello from browser A')
            await a.click('#sendBtn')
            await b.get_by_text('Test E2EE hello from browser A').wait_for(timeout=10000)
            print('PASS: encrypted WebRTC chat delivered from A to B')
            await a.click('#callBtn')
            await b.locator('#incomingDialog').wait_for(state='visible',timeout=10000)
            await b.click('#acceptBtn')
            await a.wait_for_function('document.querySelector("#localVideo").srcObject && document.querySelector("#localVideo").srcObject.getTracks().length >= 2',timeout=20000)
            await b.wait_for_function('document.querySelector("#localVideo").srcObject && document.querySelector("#localVideo").srcObject.getTracks().length >= 2',timeout=20000)
            await a.wait_for_function('document.querySelector("#remoteVideo").srcObject && document.querySelector("#remoteVideo").srcObject.getTracks().length >= 2',timeout=20000)
            print('PASS: video call accepted, local/remote audio+video media tracks received')
            await a.click('#hangupBtn')
            await b.wait_for_function('document.querySelector("#callOverlay").classList.contains("hidden")',timeout=10000)
            print('PASS: hang-up reaches remote phone')
            for line in logs:
              if line[1]=='error': print('Error:',line)
          finally:
            for ctx in contexts: await ctx.close()
            await browser.close()
      http.terminate()

if __name__=='__main__':
    asyncio.run(main())
