// 피지원자가 메일 링크를 눌렀을 때 보는 화면.
// 순서: 회사 계정 확인 → 동의 → 지원 프로그램이 접속 정보 전달 → 담당자 접속
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
         padding:16px; font-size:16px; font-weight:bold; cursor:pointer; text-align:center;
         text-decoration:none; box-sizing:border-box; }
  .btn.ms { background:#2f2f2f; display:flex; align-items:center; justify-content:center; gap:10px; }
  .btn.ms svg { flex:0 0 auto; }
  .note { background:#eff6ff; border-left:3px solid #2563eb; padding:12px 14px; border-radius:6px;
          font-size:14px; color:#1e3a8a; margin:0 0 18px; }
  .who { display:flex; align-items:center; gap:10px; background:#f3f4f6; border-radius:9px;
         padding:11px 13px; margin:0 0 18px; font-size:14px; }
  .who .av { width:30px; height:30px; border-radius:50%; background:#2563eb; color:#fff;
             display:flex; align-items:center; justify-content:center; font-weight:bold;
             font-size:13px; flex:0 0 auto; }
  .who b { display:block; } .who span { color:#6b7280; font-size:12.5px; }
  .muted { font-size:13px; color:#6b7280; }
  .step { display:none; } .step.on { display:block; }
  label { display:block; font-size:13px; font-weight:bold; margin:14px 0 6px; color:#374151; }
  input { width:100%; box-sizing:border-box; padding:12px; font-size:16px;
          border:1px solid #d1d5db; border-radius:8px; }
  .err { color:#b91c1c; font-size:14px; margin-top:10px; }
  .ok { text-align:center; } .ok .mark { font-size:44px; }
  .spin { width:34px; height:34px; margin:6px auto 16px; border:3px solid #dbeafe;
          border-top-color:#2563eb; border-radius:50%; animation:sp 1s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation:none; } }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#e5e7eb; }
    .card { background:#1e293b; box-shadow:none; }
    p { color:#cbd5e1; } .note { background:#1e3a5f; color:#bfdbfe; }
    .who { background:#0f172a; } .who span { color:#94a3b8; }
    input { background:#0f172a; color:#e5e7eb; border-color:#334155; }
    .err { color:#f87171; } .spin { border-color:#1e3a5f; border-top-color:#60a5fa; }
  }
</style></head><body><div class="card">${body}</div></body></html>`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const noteBlock = (session) => session.note
  ? `<div class="note">요청 내용: <b>${escapeHtml(session.note)}</b></div>` : '';

const whoBlock = (session) => `
  <div class="who">
    <span class="av">${escapeHtml((session.authedName || '?').trim().charAt(0).toUpperCase())}</span>
    <span><b>${escapeHtml(session.authedName || '')}</b>
      <span>${escapeHtml(session.authedUpn || '')}${session.isGuest ? ' · 게스트' : ''}</span></span>
  </div>`;

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

  if (state === 'autherror') {
    return SHELL('로그인 실패', `
      <h1>로그인을 마치지 못했습니다</h1>
      <p>로그인이 취소되었거나 처리 중 문제가 생겼습니다. 메일의 링크를 다시 눌러 주세요.</p>`);
  }

  // 회사 계정으로 본인 확인
  if (state === 'login') {
    return SHELL('본인 확인', `
      <h1>회사 계정으로 로그인해 주세요</h1>
      ${noteBlock(session)}
      <p>원격지원을 요청하신 분이 맞는지 확인합니다.
         <b>${escapeHtml(session.email)}</b> 계정으로 로그인해 주세요.</p>
      <a class="btn ms" href="/auth/login/${encodeURIComponent(token)}">
        <svg width="17" height="17" viewBox="0 0 23 23" aria-hidden="true">
          <rect width="10" height="10" x="1" y="1" fill="#f25022"/>
          <rect width="10" height="10" x="12" y="1" fill="#7fba00"/>
          <rect width="10" height="10" x="1" y="12" fill="#00a4ef"/>
          <rect width="10" height="10" x="12" y="12" fill="#ffb900"/>
        </svg>Microsoft 계정으로 로그인</a>
      <p class="muted" style="margin-top:14px">본인이 요청하지 않은 지원이라면 이 창을 닫으세요.</p>`);
  }

  // Entra 미설정 개발 환경 전용
  if (state === 'devlogin') {
    return SHELL('개발용 로그인', `
      <h1>개발용 로그인</h1>
      <div class="note">Entra 설정이 없어 임시 로그인 화면이 표시됩니다. 실제 배포에서는 나타나지 않습니다.</div>
      <form method="post" action="/auth/dev/${encodeURIComponent(token)}">
        <label for="upn">계정</label>
        <input id="upn" name="upn" value="${escapeHtml(session.email)}" autocomplete="off">
        <button class="btn" type="submit" style="margin-top:16px">로그인</button>
      </form>`);
  }

  // 초대받은 계정과 다른 계정으로 로그인한 경우
  if (state === 'mismatch') {
    return SHELL('계정 불일치', `
      <h1>다른 계정으로 로그인되었습니다</h1>
      ${whoBlock(session)}
      <p>이 링크는 <b>${escapeHtml(session.email)}</b> 님에게 발송되었습니다.
         해당 계정으로 다시 로그인해 주세요.</p>
      <a class="btn" href="/auth/login/${encodeURIComponent(token)}">다른 계정으로 로그인</a>`);
  }

  // 연결 준비 완료 (새로고침으로 다시 들어온 경우)
  if (state === 'ready') {
    return SHELL('연결 준비 완료', `
      <div class="ok"><div class="mark">✅</div>
      <h1>담당자에게 전달되었습니다</h1>
      <p>잠시 후 화면에 <b>연결 수락</b> 창이 나타납니다.<br>
         <b>수락</b>을 눌러주시면 연결이 시작됩니다.</p>
      <p class="muted">이 창은 닫으셔도 됩니다.</p></div>`);
  }

  // 동의 → 대기 → 완료
  const startAtWaiting = state === 'waiting';
  return SHELL('원격지원 연결', `
    <div id="step-consent" class="step${startAtWaiting ? '' : ' on'}">
      <h1>원격지원을 시작할까요?</h1>
      ${whoBlock(session)}
      ${noteBlock(session)}
      <p>IT 담당자가 이 컴퓨터에 원격으로 접속해 문제를 확인합니다.
         연결 중에는 화면에 표시되며, 언제든 직접 종료할 수 있습니다.</p>
      <button class="btn" id="accept">동의하고 연결 시작</button>
      <p class="muted" style="margin-top:14px">본인이 요청하지 않은 지원이라면 이 창을 닫으세요.</p>
    </div>

    <div id="step-wait" class="step${startAtWaiting ? ' on' : ''}">
      <div class="ok"><div class="spin"></div>
        <h1>연결을 준비하고 있습니다</h1>
        <p>이 컴퓨터의 지원 프로그램을 확인하는 중입니다. 잠시만 기다려 주세요.</p></div>
      <div id="fallback" style="display:none">
        <p class="muted" style="border-top:1px solid #e5e7eb;padding-top:16px">
          프로그램을 찾지 못했습니다. 지원 프로그램을 직접 실행한 뒤,
          화면에 표시된 <b>ID</b>를 입력해 주세요.</p>
        <a class="btn" id="deeplink" href="rustdesk://" style="margin-bottom:6px">지원 프로그램 열기</a>
        <label for="rid">ID (숫자)</label>
        <input id="rid" inputmode="numeric" autocomplete="off" placeholder="예: 123456789">
        <label for="pw">비밀번호 <span style="font-weight:normal;color:#6b7280">(표시된 경우에만)</span></label>
        <input id="pw" autocomplete="off" placeholder="비밀번호가 보이지 않으면 비워두세요">
        <div class="err" id="err"></div>
        <button class="btn" id="submit" style="margin-top:14px">담당자에게 전달</button>
      </div>
    </div>

    <div id="step-done" class="step ok">
      <div class="mark">✅</div>
      <h1>담당자에게 전달되었습니다</h1>
      <p>잠시 후 화면에 <b>연결 수락</b> 창이 나타납니다.<br>
         <b>수락</b>을 눌러주시면 연결이 시작됩니다.</p>
      <p class="muted">이 창은 닫으셔도 됩니다.</p>
    </div>

    <script>
      var token = ${JSON.stringify(token)};
      var poll = null;

      function show(id) {
        document.querySelectorAll('.step').forEach(function (el) { el.classList.remove('on'); });
        document.getElementById(id).classList.add('on');
      }

      // 상주 핸들러가 접속 정보를 알려줄 때까지 상태를 확인한다.
      function waitForAgent() {
        var tries = 0;
        poll = setInterval(function () {
          tries++;
          fetch('/api/s/' + token + '/status')
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.status === 'ready') { clearInterval(poll); show('step-done'); }
              else if (tries >= 8) {
                clearInterval(poll);
                document.getElementById('fallback').style.display = 'block';
              }
            })
            .catch(function () {});
        }, 1500);
      }

      document.getElementById('accept').addEventListener('click', function () {
        fetch('/api/s/' + token + '/accept', { method: 'POST' }).then(function () {
          show('step-wait');
          // 사내 PC 에 배포된 핸들러를 깨운다. 없으면 아무 일도 일어나지 않는다.
          location.href = 'supportlink://session/' + token;
          waitForAgent();
        });
      });

      document.getElementById('submit').addEventListener('click', function () {
        var err = document.getElementById('err');
        err.textContent = '';
        fetch('/api/s/' + token + '/ready', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rustdeskId: document.getElementById('rid').value,
            password: document.getElementById('pw').value,
          }),
        }).then(function (res) {
          if (res.ok) { show('step-done'); return; }
          return res.json().then(function (d) { err.textContent = d.error || '전송에 실패했습니다'; });
        });
      });

      if (${startAtWaiting ? 'true' : 'false'}) waitForAgent();
    </script>`);
}
