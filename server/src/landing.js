// 피지원자가 메일 링크를 눌렀을 때 보는 안내 페이지.
// 원격 접속 전 반드시 본인이 동의하는 화면을 거치도록 한다.
import { config } from './config.js';

const SHELL = (title, body) => `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: 'Malgun Gothic', -apple-system, sans-serif; margin:0;
         display:flex; align-items:center; justify-content:center; min-height:100vh;
         background:#f4f6fa; color:#111; padding:20px; }
  .card { background:#fff; border-radius:14px; box-shadow:0 6px 30px rgba(0,0,0,.09);
          max-width:460px; width:100%; padding:32px; }
  h1 { font-size:21px; margin:0 0 12px; }
  p { color:#4b5563; line-height:1.65; margin:0 0 14px; font-size:15px; }
  .btn { display:block; width:100%; background:#2563eb; color:#fff; border:0; border-radius:9px;
         padding:16px; font-size:16px; font-weight:bold; cursor:pointer; text-align:center; }
  .btn:disabled { background:#9ca3af; cursor:default; }
  .note { background:#eff6ff; border-left:3px solid #2563eb; padding:12px 14px; border-radius:6px;
          font-size:14px; color:#1e3a8a; margin:0 0 18px; }
  .muted { font-size:13px; color:#6b7280; }
  .step { display:none; }
  .step.on { display:block; }
  label { display:block; font-size:13px; font-weight:bold; margin:14px 0 6px; color:#374151; }
  input { width:100%; box-sizing:border-box; padding:12px; font-size:16px;
          border:1px solid #d1d5db; border-radius:8px; }
  .err { color:#b91c1c; font-size:14px; margin-top:10px; }
  .ok { text-align:center; }
  .ok .mark { font-size:44px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#e5e7eb; }
    .card { background:#1e293b; box-shadow:none; }
    p { color:#cbd5e1; } .note { background:#1e3a5f; color:#bfdbfe; }
    input { background:#0f172a; color:#e5e7eb; border-color:#334155; }
  }
</style></head><body><div class="card">${body}</div></body></html>`;

export function renderLanding({ state, session, token }) {
  if (state === 'invalid') {
    return SHELL('링크 오류', `
      <h1>유효하지 않은 링크입니다</h1>
      <p>주소가 잘못되었거나 이미 사용된 링크입니다. 담당자에게 새 링크를 요청해 주세요.</p>`);
  }

  if (state === 'expired') {
    return SHELL('링크 만료', `
      <h1>링크가 만료되었습니다</h1>
      <p>보안을 위해 원격지원 링크는 ${config.sessionTtlMinutes}분 후 자동으로 만료됩니다.
         담당자에게 새 링크를 요청해 주세요.</p>`);
  }

  const note = session.note
    ? `<div class="note">요청 내용: <b>${escapeHtml(session.note)}</b></div>`
    : '';

  const consent = `
    <div id="step-consent" class="step on">
      <h1>원격지원을 시작할까요?</h1>
      ${note}
      <p>IT 담당자가 이 컴퓨터에 원격으로 접속해 문제를 확인합니다.
         연결 중에는 화면에 표시되며, 언제든 직접 종료할 수 있습니다.</p>
      <button class="btn" id="accept">동의하고 연결 시작</button>
      <p class="muted" style="margin-top:14px">본인이 요청하지 않은 지원이라면 이 창을 닫으세요.</p>
    </div>`;

  // 회사에서 관리하는 PC: 지원 프로그램이 이미 상주하므로 동의만 하면 된다.
  if (session.managed) {
    return SHELL('원격지원 연결', `
      ${consent}
      <div id="step-done" class="step ok">
        <div class="mark">✅</div>
        <h1>담당자에게 전달되었습니다</h1>
        <p>잠시 후 화면에 <b>연결 수락</b> 창이 나타납니다.<br>
           <b>수락</b>을 눌러주시면 연결이 시작됩니다.</p>
        <p class="muted">이 창은 닫으셔도 됩니다.</p>
      </div>
      <script>
        const token = ${JSON.stringify(token)};
        document.getElementById('accept').addEventListener('click', async () => {
          await fetch('/api/s/' + token + '/accept', { method: 'POST' });
          document.getElementById('step-consent').classList.remove('on');
          document.getElementById('step-done').classList.add('on');
        });
      </script>`);
  }

  // 미등록 기기(외부 지원): 프로그램을 실행하고 화면의 ID를 알려주어야 한다.
  return SHELL('원격지원 연결', `
    ${consent}

    <div id="step-connect" class="step">
      <h1>지원 프로그램을 실행해 주세요</h1>
      <p>연결 프로그램이 자동으로 실행됩니다. 실행되지 않으면 아래 버튼을 눌러주세요.</p>
      <a class="btn" id="deeplink" href="#">지원 프로그램 열기</a>

      <p class="muted" style="margin-top:20px">프로그램이 열리면 화면에 표시된
         <b>ID</b>를 아래에 입력해 주세요.</p>
      <label for="rid">ID (숫자)</label>
      <input id="rid" inputmode="numeric" autocomplete="off" placeholder="예: 123456789">
      <label for="pw">비밀번호 <span style="font-weight:normal;color:#6b7280">(표시된 경우에만)</span></label>
      <input id="pw" autocomplete="off" placeholder="비밀번호가 보이지 않으면 비워두세요">
      <div class="err" id="err"></div>
      <button class="btn" id="submit" style="margin-top:16px">담당자에게 전달</button>
    </div>

    <div id="step-done" class="step ok">
      <div class="mark">✅</div>
      <h1>준비가 완료되었습니다</h1>
      <p>담당자가 곧 접속합니다. 이 창은 닫으셔도 됩니다.<br>
         연결 요청이 뜨면 <b>수락</b>을 눌러주세요.</p>
    </div>

    <script>
      const token = ${JSON.stringify(token)};
      const show = (id) => {
        document.querySelectorAll('.step').forEach(el => el.classList.remove('on'));
        document.getElementById(id).classList.add('on');
      };

      document.getElementById('accept').addEventListener('click', async () => {
        await fetch('/api/s/' + token + '/accept', { method: 'POST' });
        const scheme = 'rustdesk://';
        document.getElementById('deeplink').href = scheme;
        location.href = scheme;
        show('step-connect');
      });

      document.getElementById('submit').addEventListener('click', async () => {
        const err = document.getElementById('err');
        err.textContent = '';
        const res = await fetch('/api/s/' + token + '/ready', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rustdeskId: document.getElementById('rid').value,
            password: document.getElementById('pw').value,
          }),
        });
        if (res.ok) show('step-done');
        else err.textContent = (await res.json()).error || '전송에 실패했습니다';
      });
    </script>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
