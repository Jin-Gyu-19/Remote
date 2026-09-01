// 회사 SMTP로 원격지원 링크를 발송한다.
// SMTP 미설정 시에는 콘솔에 출력하는 개발용 전송기로 대체되어, 자격증명 없이도 흐름을 검증할 수 있다.
import nodemailer from 'nodemailer';
import { config, smtpConfigured } from './config.js';

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    })
  : nodemailer.createTransport({ jsonTransport: true });

export function mailerMode() {
  return smtpConfigured ? `smtp(${config.smtp.host})` : 'console(개발용)';
}

function renderHtml({ link, note, ttlMinutes }) {
  const reason = note
    ? `<p style="margin:0 0 16px;color:#444">요청 내용: <b>${escapeHtml(note)}</b></p>`
    : '';
  return `<!doctype html>
<div style="font-family:'Malgun Gothic',sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px;color:#111">원격지원 연결 안내</h2>
  <p style="margin:0 0 16px;color:#444">아래 버튼을 누르면 담당자와 바로 연결됩니다. 별도의 코드 입력은 필요하지 않습니다.</p>
  ${reason}
  <p style="margin:24px 0">
    <a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;display:inline-block;font-weight:bold">원격지원 시작하기</a>
  </p>
  <p style="margin:0 0 8px;color:#666;font-size:13px">이 링크는 <b>${ttlMinutes}분 동안</b>만 사용할 수 있으며, 한 번만 연결됩니다.</p>
  <p style="margin:0;color:#666;font-size:13px">연결 전 본인 확인 창이 표시되며, 언제든 종료할 수 있습니다. 요청하지 않은 메일이라면 무시하세요.</p>
</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export async function sendSessionLink({ to, link, note, ttlMinutes }) {
  const info = await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject: '[원격지원] 연결 링크가 도착했습니다',
    text: `원격지원 연결 링크입니다. ${ttlMinutes}분 내에 접속해 주세요.\n${link}`,
    html: renderHtml({ link, note, ttlMinutes }),
  });

  if (!smtpConfigured) {
    console.log(`\n[개발용 메일] to=${to}\n  링크: ${link}\n`);
  }
  return info;
}
