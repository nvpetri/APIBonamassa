import { Injectable } from "@nestjs/common";
import { config } from "./config";

@Injectable()
export class Mailer {
  async code(to: string, code: string, kind: "verify" | "reset") {
    const env = config();
    const subject =
      kind === "verify"
        ? "Confirme seu e-mail na Bonamassa"
        : "Código para redefinir sua senha";
    const action =
      kind === "verify" ? "confirmar seu e-mail" : "redefinir sua senha";
    if (!env.EMAIL_API_KEY) {
      if (env.NODE_ENV === "production")
        throw new Error("EMAIL_API_KEY não configurada.");
      console.info(`[email:${kind}] ${to} código ${code}`);
      return;
    }
    const response = await fetch(env.EMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>Bonamassa</h2><p>Use o código abaixo para ${action}:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>Ele expira em ${env.VERIFICATION_CODE_MINUTES} minutos. Se você não solicitou isso, ignore este e-mail.</p></div>`,
      }),
    });
    if (!response.ok)
      throw new Error(`Falha ao enviar e-mail: ${response.status}`);
  }
}
