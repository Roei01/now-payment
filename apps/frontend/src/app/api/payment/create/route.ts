import { NextResponse } from "next/server";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  const body = await request.text();

  let response: Response;
  try {
    response = await fetch(`${backendUrl}/api/payment/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `לא ניתן להתחבר לשרת: ${message}` },
      { status: 502 },
    );
  }

  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: `תגובה לא תקינה מהשרת (${response.status}): ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
