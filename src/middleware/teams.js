import { ROLES, findTeamForMember } from "../models/teams.js";
import { AppError } from "./errors.js";

/**
 * URL の :teamId のチームを読み込み、req.team と req.membership を埋める。
 * チーム配下のルートはすべてこれを通し、所属確認をハンドラに書かない。
 *
 * 所属していない場合は 403 ではなく 404 を返す。403 だと「そのチームは実在する」
 * ことが分かってしまい、ID を総当たりすればチームの存在を列挙できてしまうため。
 */
export async function loadTeam(req, res, next) {
  const teamId = Number(req.params.teamId);
  if (!Number.isInteger(teamId)) {
    return next(new AppError(404, "チームが見つかりません"));
  }

  try {
    const team = await findTeamForMember(teamId, req.user.id);
    if (!team) {
      return next(new AppError(404, "チームが見つかりません"));
    }

    req.team = team;
    req.membership = { role: team.role };
    res.locals.team = team;
    next();
  } catch (err) {
    next(err);
  }
}

/** リーダーだけに許す操作。loadTeam の後段に置く。 */
export function requireLeader(req, res, next) {
  if (req.membership?.role !== ROLES.LEADER) {
    return next(new AppError(403, "この操作はチームのリーダーだけが行えます"));
  }
  next();
}
