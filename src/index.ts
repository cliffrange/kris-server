const express = require("express");
const bodyParser = require("body-parser");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
const nanoid = require("nanoid");
const { MongoClient } = require("mongodb");
const amqp = require("amqplib");
const fileUpload = require("express-fileupload");
const parse = require("csv-parse/lib/sync");

const dbName = "cketlive";
const updatesQName = "updates";
const scoreQName = "score";

import players1 from "./dummy/players1.json";
import players2 from "./dummy/players2.json";

import {
  init as initMatches,
  getMatch,
  updateMatch,
  replaceMatch,
} from "./repository/match";

import { init as initTeams } from "./repository/team";
import { init as initPlayers } from "./repository/players";
import { init as initUsers } from "./repository/user";

import {
  rootReducer as update,
  matchStates,
  actionTypes,
  SavedTeam,
  Team,
  MatchState,
  Player,
  scoreStreamStates,
  PickedTeam,
} from "@cliffrange/kris-store";
import { createMatch, CreateMatchInput } from "./usecases/match";
import { CreateTeamInput, createTeam } from "./usecases/team";

const app = express();
const port = 8082;
let mongoClient;
let amqpConn;
let updatesCh;

const authConfig = {
  domain: "dev-6w0sykw3.auth0.com",
  audience: "cket.live",
};

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${authConfig.domain}/.well-known/jwks.json`,
  }),
  audience: authConfig.audience,
  issuer: `https://${authConfig.domain}/`,
  algorithms: ["RS256"],
});

app.use(bodyParser.json());

app.use(fileUpload());

app.post("/api/ball", async (req, res) => {
  const match = await getMatch(req.body.matchId);
  const updateObj = {
    type: actionTypes.BALL,
    ...req.body.ball,
  };
  updatesCh.sendToQueue(
    updatesQName,
    Buffer.from(
      JSON.stringify({ update: updateObj, matchId: req.body.matchId })
    )
  );
  const updatedMatch = update(match, updateObj);
  updatesCh.sendToQueue(
    scoreQName,
    Buffer.from(
      JSON.stringify({ score: updatedMatch, matchId: req.body.matchId })
    )
  );
  await updateMatch(req.body.matchId, updatedMatch);
  res.send();
});

app.post("/api/action", async (req, res) => {
  const match = await getMatch(req.body.matchId);
  const updateObj = req.body.action;
  updatesCh.sendToQueue(
    updatesQName,
    Buffer.from(
      JSON.stringify({ update: updateObj, matchId: req.body.matchId })
    )
  );
  const updatedMatch = update(match, updateObj);
  await updateMatch(req.body.matchId, updatedMatch);
  res.send();
});

app.post("/api/select-new-batter", async (req, res) => {
  const match = await getMatch(req.body.matchId);
  const updateObj = {
    type: actionTypes.PICK_BATTER,
    ...req.body.batterInfo,
  };
  updatesCh.sendToQueue(
    updatesQName,
    Buffer.from(
      JSON.stringify({ update: updateObj, matchId: req.body.matchId })
    )
  );
  const upd = update(match, updateObj);
  await updateMatch(req.body.matchId, upd);
  res.send();
});

app.post("/api/select-bowler", async (req, res) => {
  const match = await getMatch(req.body.matchId);
  const updateObj = {
    type: actionTypes.PICK_BOWLER,
    ...req.body.bowlerInfo,
  };
  updatesCh.sendToQueue(
    updatesQName,
    Buffer.from(
      JSON.stringify({ update: updateObj, matchId: req.body.matchId })
    )
  );
  const upd = update(match, updateObj);
  await updateMatch(req.body.matchId, upd);
  res.send();
});

app.post("/api/create-dummy-match", checkJwt, async (req, res) => {
  const team1ID = nanoid();
  const team1: CreateTeamInput = {
    teamID: team1ID,
    teamName: "Aligators",
    user: req.user.sub,
    players: players1,
  };
  await createTeam(team1);

  const team2ID = nanoid();
  const team2: CreateTeamInput = {
    teamID: team2ID,
    teamName: "Crawlers",
    user: req.user.sub,
    players: players2,
  };
  await createTeam(team2);
});

app.post("/api/bulk/players", checkJwt, async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  let records: Array<{
    first_name: string;
    last_name: string;
    role: string;
    team_name: string;
  }>;

  try {
    records = parse(req.files.File.data.toString(), {
      columns: true,
      skip_empty_lines: true,
    });
  } catch (e) {
    res.status(400).send(e);
  }

  if (!records) {
    return;
  }

  const teams: { [name: string]: CreateTeamInput } = {};
  records.forEach((player) => {
    const { team_name: s } = player;
    const teamName = `${s[0].toUpperCase()}${s
      .replace(s[0], "")
      .toLowerCase()}`;

    if (!teams[teamName]) {
      const teamID = nanoid();
      const team: CreateTeamInput = {
        teamID: teamID,
        teamName: teamName,
        user: req.user.sub,
        players: [],
      };
      teams[teamName] = team;
    }

    teams[teamName].players.push({
      firstName: player.first_name,
      lastName: player.last_name,
      role: player.role,
    });
  });

  const teamslist = Object.values(teams);
  const creates = teamslist.map((c) => createTeam(c));
  await Promise.all(creates);
  res.send({
    numberOfTeams: teamslist.length,
  });
});

app.post("/api/create-match", checkJwt, async (req, res) => {
  const teamsCol = mongoClient.db(dbName).collection("teams");
  const playersCol = mongoClient.db(dbName).collection("players");

  const { teams, shortNames, description, properties, matchID } = req.body;

  const teamIDs = teams.slice(0, 2).map((t) => t.teamID);

  const shortNamesObj = {
    [teamIDs[0]]: shortNames[0],
    [teamIDs[1]]: shortNames[1],
  };

  const fullTeamsRes = await teamsCol.find({ _id: { $in: teamIDs } }).toArray();

  const fullTeams: PickedTeam[] = fullTeamsRes.map((res) => ({
    ...res,
    teamID: res._id,
  }));

  const createMatchInput: CreateMatchInput = {
    matchID,
    description,
    properties,
    teams: [],
    user: req.user.sub,
  };

  const getPlayers = fullTeams.map(async (pickedTeam) => {
    const batLineup = pickedTeam.playerIDs.slice(0, 11);
    const playerEntries = await playersCol
      .find({ _id: { $in: batLineup } })
      .toArray();

    createMatchInput.teams.push({
      teamID: pickedTeam.teamID,
      players: playerEntries,
      playerIDs: playerEntries.map((p) => p._id),
      teamName: pickedTeam.teamName,
      shortName: shortNamesObj[pickedTeam.teamID],
    });
  });

  await Promise.all(getPlayers);

  const matchSummary = await createMatch(createMatchInput);
  res.send(matchSummary);
});

app.post("/api/select-players/:id", checkJwt, async (req, res) => {
  const matchesCol = mongoClient.db(dbName).collection("matches");
  const playersCol = mongoClient.db(dbName).collection("players");
  const { players: playerIDs, matchId } = req.body;
  const teams = Object.keys(playerIDs).slice(0, 2);

  const savedMatch: MatchState = await getMatch(req.params.id);

  const playerInfo = {};

  const updatePlayerInfo = teams.map(async (teamID, idx) => {
    const batLineup = playerIDs[teamID].slice(0, 11);
    const playerEntries = await playersCol
      .find({ _id: { $in: batLineup } })
      .toArray();
    const players: { [g: string]: Player } = {};

    playerEntries.forEach((p, idx) => {
      const player = {
        id: p._id,
        firstName: p.firstName,
        lastName: p.lastName,
        role: p.role,
      };
      players[player.id] = player;
    });

    playerInfo[teamID] = {
      batLineup,
      players,
    };
  });

  await Promise.all(updatePlayerInfo);

  const upd = update(savedMatch, {
    type: actionTypes.SELECT_PLAYERS,
    playerInfo,
  });
  await replaceMatch(matchId, upd);
  res.send();
});

app.post("/api/create-team", checkJwt, async (req, res) => {
  const reqBody: {
    teamID: string;
    teamName: string;
    players: Player[];
  } = req.body;

  const { teamID, teamName, players } = reqBody;

  const createTeamInput: CreateTeamInput = {
    teamID,
    teamName,
    players,
    user: req.user.sub,
  };

  const newTeam = await createTeam(createTeamInput);

  res.send(newTeam);
});

app.post("/api/start-match", async (req, res) => {
  const { battingTeamID, bowlingTeamID, teams } = req.body;

  const newMatch: Partial<MatchState> = {
    state: matchStates.LIVE,
    battingTeamID,
    bowlingTeamID,
    teams,
  };

  await updateMatch(req.body._id, newMatch);
  res.send();
});

app.post("/api/start-innings", async (req, res) => {
  const {
    currentBatterIDs,
    currentStrikerID,
    currentBowlerID,
    teams,
    _id: matchId,
  } = req.body;

  const updateObj = {
    type: actionTypes.START_INNINGS,
    matchId,
    currentBatterIDs,
    currentStrikerID,
    currentBowlerID,
  };

  updatesCh.sendToQueue(
    updatesQName,
    Buffer.from(JSON.stringify({ update: updateObj, matchId }))
  );

  const newMatch: Partial<MatchState> = {
    state: matchStates.LIVE,
    teams,
  };

  await updateMatch(req.body._id, newMatch);
  res.send();
});

app.get("/user", async (req, res) => {
  res.send({ user: "aruna" });
});

app.get("/api/user", async (req, res) => {
  const usersCol = mongoClient.db(dbName).collection("users");
  const matchesCol = mongoClient.db(dbName).collection("matches");
  const teamsCol = mongoClient.db(dbName).collection("teams");
  const { value: user } = await usersCol.findOneAndUpdate(
    { _id: req.user.sub },
    {
      $setOnInsert: { teams: [], matches: {}, tournaments: [] },
    },
    { returnNewDocument: true, upsert: true }
  );
  const matchIDs = Object.keys(user.matches);
  const teamIDs = user.teams.map((t) => t.teamID);
  const matchesResult: (MatchState & {
    _id: string;
  })[] = await matchesCol.find({ _id: { $in: matchIDs } }).toArray();
  const teamsResult: (Team & {
    _id: string;
  })[] = await teamsCol.find({ _id: { $in: teamIDs } }).toArray();

  matchesResult.forEach((m) => {
    try {
      const teams = Object.values(m.teams);

      user.matches[m._id].teams = teams.map((t) => ({
        teamShortName: t.teamShortName,
        score: t.score,
      }));
    } catch {}
  });

  user.teams = teamsResult.map((t) => ({
    teamName: t.teamName,
    noOfPlayers: t.playerIDs.length,
    teamID: t.teamID,
  }));

  res.send(user);
});

app.get("/api/match/:id", async (req, res) => {
  const match = await getMatch(req.params.id);
  res.send(match);
});

app.post("/api/scorestream/:id", async (req, res) => {
  const match = await getMatch(req.params.id);
  const newMatch = {
    scoreStreamState: scoreStreamStates.STREAM_REQUESTED,
  };
  updatesCh.sendToQueue(
    scoreQName,
    Buffer.from(
      JSON.stringify({
        matchId: req.params.id,
        streamState: scoreStreamStates.STREAM_REQUESTED,
        score: match,
      })
    )
  );
  await updateMatch(req.body.matchId, newMatch);
  res.send();
});

app.get("/api/team/:id", async (req, res) => {
  const teamsCol = mongoClient.db(dbName).collection("teams");
  const playersCol = mongoClient.db(dbName).collection("players");
  const team: SavedTeam = await teamsCol.findOne({ _id: req.params.id });
  const playerEntries = await playersCol
    .find({ _id: { $in: team.playerIDs } })
    .toArray();
  const players: { [g: string]: Player } = {};

  playerEntries.forEach((p) => {
    const player = {
      id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      role: p.role,
    };
    players[player.id] = player;
  });
  res.send({ ...team, players });
});

app.post("/api/edit-team/:id", async (req, res) => {
  const teamsCol = mongoClient.db(dbName).collection("teams");
  const playersCol = mongoClient.db(dbName).collection("players");
  const reqBody: {
    teamID: string;
    teamName: string;
    newPlayers: Player[];
  } = req.body;

  const { teamName, newPlayers } = reqBody;
  const result = await playersCol.insertMany(
    newPlayers.map(({ firstName, lastName, role }) => ({
      _id: nanoid(),
      firstName,
      lastName,
      role,
    }))
  );
  const newPlayerIDs = result.ops.map((op) => op._id);
  const updateResult = await teamsCol.updateOne(
    { _id: req.params.id },
    { $push: { playerIDs: { $each: newPlayerIDs } } }
  );
  res.send({ newPlayerIDs });
});

app.delete("/api/match/:id", checkJwt, async (req, res) => {
  const usersCol = mongoClient.db(dbName).collection("users");
  await usersCol.updateOne(
    { _id: req.user.sub },
    { $unset: { [`matches.${req.params.id}`]: {} } }
  );
  res.end();
});

app.delete("/api/team/:id", checkJwt, async (req, res) => {
  const usersCol = mongoClient.db(dbName).collection("users");
  await usersCol.updateOne(
    { _id: req.user.sub },
    { $pull: { teams: { teamID: req.params.id } } }
  );
  res.end();
});

async function start() {
  const mongoUrl = process.env.MONGO_URL || "mongodb://localhost:27017";
  const qurl = process.env.QUEUE_URL || "amqp://localhost";

  mongoClient = await MongoClient.connect(mongoUrl);
  amqpConn = await amqp.connect(qurl);
  updatesCh = await amqpConn.createChannel();
  await updatesCh.assertQueue(updatesQName);
  await updatesCh.assertQueue(scoreQName);

  initMatches(mongoClient, dbName, "matches");
  initTeams(mongoClient, dbName, "teams");
  initPlayers(mongoClient, dbName, "players");
  initUsers(mongoClient, dbName, "users");
  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
}

start();
