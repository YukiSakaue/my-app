import { Router } from "express";

import { requireGuest } from "../middleware/auth.js";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordAgainstDummy,
} from "../lib/passwords.js";
import { SESSION_COOKIE, sessionCookieOptions, signSessionToken } from "../lib/tokens.js";
import { safeReturnTo, validateLogin, validateSignup } from "../lib/validation.js";
import {
  EmailTakenError,
  createUser,
  findUserByEmailWithHash,
} from "../models/users.js";

export const authRouter = Router();

function startSession(res, user) {
  res.cookie(SESSION_COOKIE, signSessionToken(user), sessionCookieOptions());
}

authRouter.get("/signup", requireGuest, (req, res) => {
  res.render("signup", { errors: [], values: { name: "", email: "" } });
});

authRouter.post("/signup", requireGuest, async (req, res, next) => {
  const { errors, values } = validateSignup(req.body);
  if (errors.length > 0) {
    return res.status(400).render("signup", { errors, values });
  }

  try {
    const passwordHash = await hashPassword(req.body.password);
    const user = await createUser({
      name: values.name,
      email: values.email,
      passwordHash,
    });

    startSession(res, user);
    res.redirect("/");
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return res.status(409).render("signup", { errors: [err.message], values });
    }
    next(err);
  }
});

authRouter.get("/login", requireGuest, (req, res) => {
  res.render("login", {
    errors: [],
    values: { email: "" },
    returnTo: safeReturnTo(req.query.returnTo),
  });
});

authRouter.post("/login", requireGuest, async (req, res, next) => {
  const returnTo = safeReturnTo(req.body.returnTo);
  const { errors, values } = validateLogin(req.body);
  if (errors.length > 0) {
    return res.status(400).render("login", { errors, values, returnTo });
  }

  try {
    const user = await findUserByEmailWithHash(values.email);
    // メールが存在しない場合とパスワード違いで応答を変えると、
    // 登録済みメールアドレスの総当たり調査を許すことになる。
    // 内容だけでなく応答時間も揃えるため、未登録でもダミーと照合する。
    const passwordMatches = user
      ? await verifyPassword(req.body.password, user.password_hash)
      : await verifyPasswordAgainstDummy(req.body.password);

    if (!passwordMatches) {
      return res.status(401).render("login", {
        errors: ["メールアドレスまたはパスワードが正しくありません"],
        values,
        returnTo,
      });
    }

    startSession(res, user);
    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

// ログアウトは状態を変えるため POST のみ受け付ける
authRouter.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.redirect("/login");
});
