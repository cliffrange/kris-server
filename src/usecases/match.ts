import {
  rootReducer as update,
  actionTypes,
  MatchState,
  matchStates,
  Player,
  scoreStreamStates,
  initialBatter,
  initialBowler,
  PlayingPlayer,
  initialScore,
  initialExtras,
  initialManhatten,
  initialWorm,
} from "@cliffrange/kris-store";

import { createMatch as CreateMatchDB } from "../repository/match";
import { addMatch } from "../repository/user";

export const createTeam = async () => {};

export interface CreateMatchInput {
  matchID;
  description;
  properties;
  user: string;
  teams: Array<{
    teamID: string;
    teamName: string;
    players: Player[];
    playerIDs: string[];
    shortName: string;
  }>;
}

export const createMatch: (input: CreateMatchInput) => void = async (input) => {
  const { description, properties, matchID, teams, user } = input;

  const match: MatchState = {
    state: matchStates.CREATED,
    scoreStreamStates: scoreStreamStates.NOT_STREAMING,
    description,
    properties,
    innings: 1,
    teams: {},
    updates: [],
    result: { state: "" },
  };

  teams.forEach((team) => {
    const playingPlayers: { [id: string]: PlayingPlayer } = {};

    team.players.forEach((p, idx) => {
      const player = {
        id: team.playerIDs[idx],
        firstName: p.firstName,
        lastName: p.lastName,
        role: p.role,
        batter: initialBatter,
        bowler: initialBowler,
      };
      playingPlayers[player.id] = player;
    });

    match.teams[team.teamID] = {
      teamID: team.teamID,
      teamName: team.teamName,
      teamShortName: team.shortName,
      batLineup: team.playerIDs,
      batOrder: [],
      currentStrikerID: undefined,
      currentBatterIDs: [],
      bowlOrder: [],
      outBatters: {},
      wickets: [],
      score: initialScore,
      extras: initialExtras,
      players: playingPlayers,
      playerIDs: team.playerIDs,
      manhatten: initialManhatten,
      worm: initialWorm,
    };
  });

  const upd = update(undefined, { type: actionTypes.CREATE_MATCH, match });
  const ops = await CreateMatchDB(matchID, upd);

  const savedId = ops[0]._id;
  const matchSummary = {
    id: savedId,
    matchID: savedId,
    name: teams[0].teamName + " vs " + teams[1].teamName,
    description,
    state: "NOT_STARTED",
    stateDescription: "Match is not started",
    score: [
      { teamName: teams[0].shortName, score: "", overs: "" },
      { teamName: teams[1].shortName, score: "", overs: "" },
    ],
    teams: [
      {
        teamShortName: teams[0].shortName,
        score: { ball: 0, over: 0, score: 0, wickets: 0 },
      },
      {
        teamShortName: teams[1].shortName,
        score: { ball: 0, over: 0, score: 0, wickets: 0 },
      },
    ],
  };

  addMatch(user, matchSummary);

  return matchSummary;
};
