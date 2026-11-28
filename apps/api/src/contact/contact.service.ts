/**
 * Service "contact" : c'est lui qui fabrique et envoie les emails de notification
 * quand quelqu'un remplit un formulaire (référencement ou déférencement).
 * Il utilise nodemailer (librairie d'envoi d'email) via un serveur SMTP
 * (le serveur de courrier sortant, type Gmail). Si la configuration SMTP est
 * absente, il n'envoie rien et se contente d'afficher l'email dans la console.
 */
import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

// Adresse qui reçoit les notifications. On la lit dans la config (variable
// d'environnement) ; si elle n'est pas définie, on utilise une adresse par défaut.
const DEST = process.env.CONTACT_EMAIL ?? "contact@example.com";

// Échappe le HTML des champs saisis par le visiteur avant insertion dans le mail :
// sans ça, un nom contenant des balises s'exécuterait dans le client mail de l'admin.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  // Le "transporter" est l'objet nodemailer qui sait envoyer un mail.
  // Il reste à null tant que le SMTP n'est pas configuré.
  private transporter: nodemailer.Transporter | null = null;

  // Au démarrage, on prépare la connexion email SI les identifiants SMTP existent.
  // Sinon, on prévient dans les logs que les emails sont désactivés.
  constructor() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (user && pass) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "smtp.gmail.com",
        port,
        // 465 = TLS dès la connexion (« SMTPS ») ; 587 = connexion en clair puis STARTTLS.
        // Avec secure:false sur 465, le serveur attend la poignée TLS et ne dit jamais bonjour :
        // GREETING_TIMEOUT, et AUCUN formulaire n'arrivait (corrigé le 20/11/2026).
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 15_000,
      });
      this.logger.log(`SMTP configuré → ${user}`);
    } else {
      this.logger.warn("SMTP_USER/SMTP_PASS non définis — emails désactivés (console only)");
    }
  }

  // Envoie un email (sujet + contenu HTML) à l'adresse de destination.
  // Méthode interne réutilisée par recenser() et deferencer().
  // replyTo : l'e-mail saisi par le demandeur, pour que « Répondre » lui écrive
  // directement (sans lui, la réponse partirait vers l'adresse d'envoi technique).
  async send(subject: string, html: string, replyTo?: string): Promise<void> {
    // Pas de SMTP configuré : on simule en affichant juste le texte dans la console.
    if (!this.transporter) {
      this.logger.log(`[EMAIL SIMULÉ] Sujet: ${subject}\n${html.replace(/<[^>]+>/g, "")}`);
      return;
    }
    const sender = process.env.SMTP_FROM ?? process.env.SMTP_USER;
    await this.transporter.sendMail({
      from: `"CarteAsso" <${sender}>`,
      to: DEST,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    this.logger.log(`Email envoyé → ${DEST} : ${subject}`);
  }

  // Template HTML partagé pour avoir un beau rendu "CarteAsso"
  private wrapHtml(title: string, content: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px; border-radius: 12px;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <h2 style="color: #111827; font-size: 20px; margin-top: 0; margin-bottom: 24px; border-bottom: 2px solid #3B82F6; padding-bottom: 10px;">
            ${title}
          </h2>
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 15px; color: #374151;">
            ${content}
          </table>
          <p style="margin-top: 30px; font-size: 13px; color: #6B7280; text-align: center;">
            Notification envoyée automatiquement par <b>CarteAsso</b>.
          </p>
        </div>
      </div>
    `;
  }

  // Construit un email récapitulatif d'une demande de référencement
  // (association à ajouter) puis l'envoie à l'admin du site.
  async recenser(data: {
    name: string; category: string; city: string; postalCode?: string;
    email: string; website?: string; description: string;
  }): Promise<void> {
    const tableContent = `
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Association</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.name)}</td></tr>
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Catégorie</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.category)}</td></tr>
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Ville</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.city)}${data.postalCode ? ` (${esc(data.postalCode)})` : ""}</td></tr>
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Email contact</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><a href="mailto:${esc(data.email)}" style="color: #3B82F6;">${esc(data.email)}</a></td></tr>
      ${data.website ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Site web</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><a href="${esc(data.website)}" style="color: #3B82F6;">${esc(data.website)}</a></td></tr>` : ""}
      <tr><td style="padding: 10px 0;"><b>Description</b></td><td style="padding: 10px 0;">${esc(data.description)}</td></tr>
    `;
    const html = this.wrapHtml("Nouvelle demande de référencement", tableContent);
    await this.send(`[CarteAsso] Référencement — ${data.name}`, html, data.email);
  }

  // Même principe que recenser(), mais pour une demande de retrait
  // (déférencement) : on prévient l'admin avec la raison invoquée.
  async deferencer(data: {
    name: string; reason: string; message?: string; email?: string;
  }): Promise<void> {
    const tableContent = `
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; width: 30%;"><b>Association</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.name)}</td></tr>
      <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Raison</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.reason)}</td></tr>
      ${data.message ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;"><b>Message</b></td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6;">${esc(data.message)}</td></tr>` : ""}
      ${data.email ? `<tr><td style="padding: 10px 0;"><b>Email contact</b></td><td style="padding: 10px 0;"><a href="mailto:${esc(data.email)}" style="color: #3B82F6;">${esc(data.email)}</a></td></tr>` : ""}
    `;
    const html = this.wrapHtml("Demande de déférencement", tableContent);
    await this.send(`[CarteAsso] Déférencement — ${data.name}`, html, data.email || undefined);
  }
}
