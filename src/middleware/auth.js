import { findUserById } from "../models/users.js";
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from "../lib/tokens.js";

/**
 * Cookie の JWT を検証し、有効なら req.user を埋める。
 * 認証の判定はここと requireAuth に集約し、各ルートハンドラには置かない。
 */
export async function attachUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;

  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return next();
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    // 期限切れや鍵の入れ替えで無効になった Cookie は消しておく
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return next();
  }

  try {
    // トークンが有効でも退会済みの可能性があるため、実在を毎回確認する
    const user = await findUserById(Number(payload.sub));
    if (user) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** 未ログインならログイン画面へ送る。ログイン後に元のページへ戻せるようにする。 */
export function requireAuth(req, res, next) {
  if (req.user) {
    return next();
  }
  const returnTo = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?returnTo=${returnTo}`);
}

/** ログイン済みのユーザーにサインアップ・ログイン画面を見せない。 */
export function requireGuest(req, res, next) {
  if (req.user) {
    return res.redirect("/");
  }
  next();
}
