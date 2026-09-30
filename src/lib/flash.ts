import { setCookie } from "hono/cookie";

export function setFlash(c: any, message: string, type: "success" | "error") {
  setCookie(c, "flash", JSON.stringify({ message, type }), { path: "/", maxAge: 10, httpOnly: false });
}
