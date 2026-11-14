const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const MAIL_PROTOCOL = "mailto:";

// The address of a web page, or undefined when the text is anything else (a program, a script, a
// file, plain words): only http and https are ever opened from what the screen shows
export function webAddress(text: string) {
  const address = URL.parse(text.trim());
  const isWebAddress = address !== null && WEB_PROTOCOLS.has(address.protocol);
  if (!isWebAddress) {
    return undefined;
  }

  return address.href;
}

// The link that starts a message to an address `detectChips` already found to be an e-mail address
export function mailtoUri(email: string) {
  return `${MAIL_PROTOCOL}${email}`;
}

// The one check before anything is opened: a web page or a new message, nothing else
export function isOpenableUri(uri: string) {
  const address = URL.parse(uri);
  const isAddress = address !== null;
  if (!isAddress) {
    return false;
  }

  return WEB_PROTOCOLS.has(address.protocol) || address.protocol === MAIL_PROTOCOL;
}
