import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({
  port: 3001,
});

type WsIncomingMessage =
  | {
      type: "connect";
      payload: {
        gameId: string;
        playerId: string;
        gameState: GameState;
      };
    }
  | {
      type: "gameState";
      payload: {
        gameState: GameState;
        gameId: string;
        playerId: string;
      };
    };

type WsOutgoingMessage =
  | {
      type: "startGame";
      payload: undefined;
    }
  | {
      type: "gameState";
      payload: {
        gameState: GameState;
      };
    }
  | {
      type: "waitingForOpponent";
      payload: undefined;
    }
  | {
      type: "joined";
      payload: {
        gameState: GameState;
      };
    };

console.log("Server started on port 3001");

const games: Record<
  string,
  {
    players: {
      [key: string]: {
        ws: WebSocket;
        playerSide: "player1" | "player2";
      };
    };
    startTime: number;
    lastState: GameState;
  }
> = {};

setInterval(() => {
  // Delete games over 12 hours old
  const now = Date.now();
  Object.entries(games).forEach(([k, v]) => {
    if (now - v.startTime > 12 * 60 * 60 * 1000) {
      Object.entries(v.players).map(([, v]) => {
        try {
          v.ws.close();
        } catch {}
      });
      delete games[k];
    }
  });
}, 60000);

type GameState = {
  player1: object;
  player2: object;
  turn: "player1" | "player2";
  winner: "player1" | "player2" | null;
  turnNumber: number;
};

const flipGameState = (gs: GameState) => ({
  ...gs,
  player1: gs.player2,
  player2: gs.player1,
  turn: gs.turn === "player1" ? ("player2" as const) : ("player1" as const),
});

const sendWsMessage = (ws: WebSocket, message: WsOutgoingMessage) => {
  ws.send(JSON.stringify(message));
};

wss.on("connection", (ws) => {
  ws.on("error", console.error);

  ws.on("message", (data) => {
    const message: WsIncomingMessage = JSON.parse(data.toString());
    if (message.type === "connect") {
      const { gameId, playerId } = message.payload;
      // New game
      if (!games[gameId]) {
        games[gameId] = {
          players: {
            [playerId]: { ws, playerSide: "player1" },
          },
          lastState: message.payload.gameState,
          startTime: Date.now(),
        };
        sendWsMessage(ws, { type: "waitingForOpponent", payload: undefined });
      } else {
        // Joining as player 2
        if (
          Object.keys(games[gameId].players).length === 1 &&
          Object.keys(games[gameId].players)[0] !== playerId
        ) {
          const player1 = Object.keys(games[gameId].players)[0];
          games[gameId].players[playerId] = { ws, playerSide: "player2" };
          sendWsMessage(ws, {
            type: "joined",
            payload: { gameState: flipGameState(games[gameId].lastState) },
          });
          sendWsMessage(games[gameId].players[player1].ws, {
            type: "startGame",
            payload: undefined,
          });
          sendWsMessage(ws, { type: "startGame", payload: undefined });
        }
        // Reconnecting
        if (games[gameId].players[playerId]) {
          games[gameId].players[playerId].ws = ws;
          sendWsMessage(ws, {
            type: "joined",
            payload: {
              gameState:
                games[gameId].players[playerId].playerSide === "player1"
                  ? games[gameId].lastState
                  : flipGameState(games[gameId].lastState),
            },
          });
        }
      }
    }
    if (message.type === "gameState") {
      const { gameId, playerId } = message.payload;
      if (!games[gameId]) return;
      const newGameState =
        games[gameId].players[playerId].playerSide === "player1"
          ? message.payload.gameState
          : flipGameState(message.payload.gameState);
      games[gameId].lastState = newGameState;
      Object.entries(games[gameId].players).forEach(([k, v]) => {
        if (k === playerId) return;
        sendWsMessage(v.ws, {
          type: "gameState",
          payload: {
            gameState:
              v.playerSide === "player1"
                ? newGameState
                : flipGameState(newGameState),
          },
        });
      });
      if (newGameState.winner) {
        Object.entries(games[gameId].players).map(([, v]) => {
          v.ws.close();
        });
        delete games[gameId];
      }
    }
  });
});
