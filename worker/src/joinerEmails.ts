/**
 * The Section Captain's three emails, in the Make scenario's wording (as
 * reworded 27 Sep 2026), with links instead of attachments: Eddy's emails
 * never carry documents (mailer.ts).
 */

export interface Sender {
  name: string;
  designation: string;
}

export interface InvitationFacts {
  preferredName: string;
  email: string;
  newMember: boolean;
  viceCaptains: string[];
  viceCaptainEmail: string;
  officerName: string | null;
  officerEmail: string;
  sponsorName: string | null;
  app: string;
  /** The New Members Info Sheet, once the club has given Eddy a copy. */
  infoSheetUrl: string | null;
  termsUrl: string;
  sender: Sender;
}

const andList = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

const signOff = (s: Sender) => ["Best regards,", s.name, `${s.designation} – HKFC Hockey Section`];

function introductions(f: InvitationFacts): string {
  const vcs = f.viceCaptains.length ? `our Men's Vice Captains, ${andList(f.viceCaptains)} (${f.viceCaptainEmail})` : null;
  const mo = `our Men's Membership Officer, ${f.officerName ?? "the Membership Officer"} (${f.officerEmail})`;
  return `Let me introduce ${vcs ? `${vcs}, and ${mo}` : mo}.`;
}

function signInLine(f: InvitationFacts): string {
  return `Sign in with this email address (${f.email}) and we'll send you a code:`;
}

/** Stage 2: the applicant is asked to fill in their application. */
export function invitationEmail(f: InvitationFacts): { subject: string; text: string } {
  const subject = "Application to join the Hockey Section";
  const apply = `${f.app}/apply`;
  if (!f.newMember) {
    return {
      subject,
      text: [
        `Dear ${f.preferredName},`,
        "",
        "Welcome to HKFC Men's Hockey. It's great to have you joining the section, and we look forward to getting you involved.",
        "",
        introductions(f),
        "",
        "To finish registering with the Men's Hockey Section, please complete the HKFC Hockey Joiner Form. It collects your playing details, kit sizes and availability, and submits your HKFC Section Membership Application for Hockey. " +
          signInLine(f),
        apply,
        ...(f.infoSheetUrl ? ["", "Our New Members Info Sheet:", f.infoSheetUrl] : []),
        "",
        "Once we receive it, we'll arrange your kit and your HockeyHK registration.",
        "",
        "If you have any questions, just get in touch. We're glad to have you with us for the season ahead.",
        "",
        ...signOff(f.sender),
      ].join("\n"),
    };
  }
  const steps = [
    ...(f.infoSheetUrl ? [`Review the New Members Info Sheet: ${f.infoSheetUrl}`] : []),
    `Review and keep the Guidance Notes & Terms and Conditions of your application: ${f.termsUrl}`,
    `Complete the HKFC New Joiner Form. Have ready profile photos and ID documents (HKID or passport) for yourself and, if applicable, your spouse and children, and please fill it in carefully. ${signInLine(f)} ${apply}`,
  ];
  return {
    subject,
    text: [
      `Dear ${f.preferredName},`,
      "",
      "We're pleased to confirm that the Hockey Section will support your application to join the Club. Places are limited each season, so please complete the steps below promptly.",
      "",
      `${introductions(f)}${f.sponsorName ? ` I've also copied your sponsor, ${f.sponsorName}.` : ""} We're all here to help with your application and with getting involved in the Section.`,
      "",
      "To proceed, please complete the following steps:",
      "",
      ...steps.map((s, i) => `${i + 1}. ${s}`),
      "",
      "We look forward to welcoming you to the Club!",
      "",
      ...signOff(f.sender),
    ].join("\n"),
  };
}

export interface KitFacts {
  convenorName: string | null;
  preferredName: string;
  mobileNo: string | null;
  sponsorName: string | null;
  shirtNo: number | null;
  sizes: { shirt: string | null; shorts: string | null; socks: string | null };
  taskUrl: string;
  sender: Sender;
}

/** The Kit Convenor is asked for kit. */
export function kitEmail(f: KitFacts): { subject: string; text: string } {
  const who = `${f.preferredName}${f.mobileNo ? ` (${f.mobileNo})` : ""}`;
  return {
    subject: `Kit Request for ${f.preferredName}`,
    text: [
      `Dear ${f.convenorName ?? "Kit Convenor"},`,
      "",
      `I've copied ${who}, who needs kit. Could you${f.sponsorName ? ` and ${f.sponsorName}` : ""} please help with the following:`,
      "",
      `- Shirt No: ${f.shirtNo ?? "to allocate"}`,
      `- Shirt Size: ${f.sizes.shirt ?? "not given yet"}`,
      `- Shorts Size: ${f.sizes.shorts ?? "not given yet"}`,
      `- Socks Size: ${f.sizes.socks ?? "not given yet"}`,
      "",
      `It's in your tasks in Eddy, where you can mark it done once they have their kit: ${f.taskUrl}`,
      "",
      "Many thanks,",
      f.sender.name.split(" ")[0],
    ].join("\n"),
  };
}

export interface RegistrationFacts {
  convenorName: string | null;
  preferredName: string;
  rows: [string, string | null][];
  taskUrl: string;
  sender: Sender;
}

/** The Hockey Convenor is asked to register them with HockeyHK. */
export function registrationEmail(f: RegistrationFacts): { subject: string; text: string } {
  const width = Math.max(...f.rows.map(([k]) => k.length));
  return {
    subject: `League Registration for ${f.preferredName}`,
    text: [
      `Dear ${f.convenorName ?? "Hockey Convenor"},`,
      "",
      `I've copied ${f.preferredName}, who we'd like to register in the league. Their details are below. Their photo and ID documents are in your tasks in Eddy, where you can mark it done once they're registered: ${f.taskUrl}`,
      "",
      ...f.rows.map(([k, v]) => `${k.padEnd(width)}  ${v ?? "–"}`),
      "",
      "Many thanks,",
      f.sender.name.split(" ")[0],
    ].join("\n"),
  };
}
