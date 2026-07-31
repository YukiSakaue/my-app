import { Router } from "express";

import { AppError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { loadTeam, requireLeader } from "../middleware/teams.js";
import {
  ROLES,
  addMember,
  countLeaders,
  createTeam,
  findMemberRole,
  findTeamByInviteCode,
  listMembers,
  listTeamsForUser,
  regenerateInviteCode,
  updateMemberRole,
} from "../models/teams.js";

export const teamsRouter = Router();

teamsRouter.use(requireAuth);

const MAX_TEAM_NAME_LENGTH = 100;

async function renderTeamList(req, res, { errors = [], status = 200 } = {}) {
  const teams = await listTeamsForUser(req.user.id);
  res.status(status).render("teams/index", { teams, errors });
}

teamsRouter.get("/", async (req, res, next) => {
  try {
    await renderTeamList(req, res);
  } catch (err) {
    next(err);
  }
});

teamsRouter.get("/new", (req, res) => {
  res.render("teams/new", { errors: [], values: { name: "" } });
});

teamsRouter.post("/", async (req, res, next) => {
  const name = String(req.body.name ?? "").trim();

  if (name.length === 0 || name.length > MAX_TEAM_NAME_LENGTH) {
    return res.status(400).render("teams/new", {
      errors: [`チーム名は1〜${MAX_TEAM_NAME_LENGTH}文字で入力してください`],
      values: { name },
    });
  }

  try {
    const team = await createTeam({ name, creatorId: req.user.id });
    res.redirect(`/teams/${team.id}`);
  } catch (err) {
    next(err);
  }
});

// 招待コードでの参加。自分の意思で参加するので所属確認より前に置く。
teamsRouter.post("/join", async (req, res, next) => {
  try {
    const team = await findTeamByInviteCode(req.body.inviteCode);
    if (!team) {
      return renderTeamList(req, res, {
        errors: ["招待コードが正しくありません"],
        status: 404,
      });
    }

    await addMember(team.id, req.user.id);
    res.redirect(`/teams/${team.id}`);
  } catch (err) {
    next(err);
  }
});

// ここから先は loadTeam が所属を確認する。非所属なら 404 になる。
const teamScoped = Router({ mergeParams: true });
teamScoped.use(loadTeam);

teamScoped.get("/", async (req, res, next) => {
  try {
    const members = await listMembers(req.team.id);
    res.render("teams/show", { members, errors: [] });
  } catch (err) {
    next(err);
  }
});

teamScoped.post("/members/:userId/role", requireLeader, async (req, res, next) => {
  const targetUserId = Number(req.params.userId);
  const role = String(req.body.role ?? "");

  if (!Object.values(ROLES).includes(role)) {
    return next(new AppError(400, "指定された権限が不正です"));
  }

  try {
    // 最後のリーダーを降格させるとチームを管理できる人がいなくなる
    if (role === ROLES.MEMBER) {
      const targetRole = await findMemberRole(req.team.id, targetUserId);
      const leaders = await countLeaders(req.team.id);
      if (targetRole === ROLES.LEADER && leaders <= 1) {
        const members = await listMembers(req.team.id);
        return res.status(400).render("teams/show", {
          members,
          errors: ["リーダーが不在になるため、最後のリーダーは降格できません"],
        });
      }
    }

    const updated = await updateMemberRole(req.team.id, targetUserId, role);
    if (!updated) {
      return next(new AppError(404, "対象のメンバーが見つかりません"));
    }
    res.redirect(`/teams/${req.team.id}`);
  } catch (err) {
    next(err);
  }
});

teamScoped.post("/invite-code", requireLeader, async (req, res, next) => {
  try {
    await regenerateInviteCode(req.team.id);
    res.redirect(`/teams/${req.team.id}`);
  } catch (err) {
    next(err);
  }
});

teamsRouter.use("/:teamId", teamScoped);
