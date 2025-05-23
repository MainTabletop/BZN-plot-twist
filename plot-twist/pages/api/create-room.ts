import type { NextApiRequest, NextApiResponse } from "next";

function genCode() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ code: genCode() });
}
