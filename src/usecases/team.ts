import { Player, SavedTeam } from "@cliffrange/kris-store";
import { createTeam as CreateTeamDB } from "../repository/team";
import { createPlayers as CreatePlayersDB } from "../repository/players";

export interface CreateTeamInput {
  teamID: string;
  teamName: string;
  players: Player[];
  user: string;
}

export const createTeam: (input: CreateTeamInput) => void = async (input) => {
  const { teamID, teamName, players, user } = input;

  const playerIDs = await CreatePlayersDB(players);

  const team: SavedTeam = {
    teamID,
    teamName,
    playerIDs,
  };

  const ops = await CreateTeamDB(teamID, team, user);
  return ops;
};
