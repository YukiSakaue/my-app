import request from "supertest";

/**
 * サインアップ済みのエージェントを返す。
 * supertest の agent は Cookie を保持するため、以降のリクエストはログイン状態になる。
 */
export async function signedInAgent(app, { name, email, password = "password123" }) {
  const agent = request.agent(app);
  const res = await agent.post("/signup").type("form").send({ name, email, password });

  if (res.status !== 302) {
    throw new Error(`サインアップに失敗しました: ${res.status}`);
  }
  return agent;
}
