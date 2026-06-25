// Cloudflare Worker — 免费通过 MailChannels 发送邮件
// 部署后 worker 地址如: email-sender.your-sub.workers.dev

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }

    const { to, subject, body } = await request.json();

    const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: "noreply@066112.xyz", name: "错题复习" },
        subject: subject,
        content: [{ type: "text/plain", value: body }],
      }),
    });

    return new Response(resp.status === 202 ? "OK" : `Failed: ${await resp.text()}`, {
      status: resp.status === 202 ? 200 : 500,
    });
  },
};
