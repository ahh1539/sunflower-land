import { isFarmBlacklisted } from "features/game/actions/visit";
import { CONFIG } from "lib/config";
import { ERRORS } from "lib/errors";
import { createMachine, Interpreter, assign } from "xstate";

import { metamask } from "../../../lib/blockchain/metamask";
import { airdrop } from "../actions/airdrop";
import { createFarm as createFarmAction } from "../actions/createFarm";
import { login, Token, decodeToken, removeSession } from "../actions/login";
import { oauthorise, redirectOAuth } from "../actions/oauth";
import { CharityAddress } from "../components/CreateFarm";

// Hashed eth 0 value
const INITIAL_SESSION =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const getFarmUrl = () => {
  const farmId = new URLSearchParams(window.location.search).get("farmId");

  return parseInt(farmId!);
};

const getDiscordCode = () => {
  const code = new URLSearchParams(window.location.search).get("code");

  return code;
};

const deleteFarmUrl = () =>
  window.history.pushState({}, "", window.location.pathname);

type Farm = {
  farmId: number;
  sessionId: string;
  address: string;
  createdAt: number;
  isBlacklisted: boolean;
};

export interface Context {
  errorCode?: keyof typeof ERRORS;
  farmId?: number;
  sessionId?: string;
  hash?: string;
  address?: string;
  token?: Token;
  rawToken?: string;
  captcha?: string;
  isBlacklisted?: boolean;
}

type StartEvent = Farm & {
  type: "START_GAME";
};

type ExploreEvent = {
  type: "EXPLORE";
};

type VisitEvent = {
  type: "VISIT";
  farmId: number;
};

type ReturnEvent = {
  type: "RETURN";
};

type CreateFarmEvent = {
  type: "CREATE_FARM";
  charityAddress: CharityAddress;
  donation: number;
  captcha: string;
};

type LoadFarmEvent = {
  type: "LOAD_FARM";
};

export type BlockchainEvent =
  | StartEvent
  | ExploreEvent
  | VisitEvent
  | ReturnEvent
  | CreateFarmEvent
  | LoadFarmEvent
  | {
      type: "NETWORK_CHANGED";
    }
  | {
      type: "ACCOUNT_CHANGED";
    }
  | {
      type: "REFRESH";
    }
  | {
      type: "LOGOUT";
    }
  | { type: "CONNECT_TO_DISCORD" }
  | { type: "AIRDROP" }
  | { type: "CONFIRM" }
  | { type: "CONTINUE" };

export type BlockchainState = {
  value:
    | "visiting"
    | "minimised"
    | "connecting"
    | "connected"
    | "signing"
    | "oauthorising"
    | "blacklisted"
    | { connected: "loadingFarm" }
    | { connected: "farmLoaded" }
    | { connected: "checkingAccess" }
    | { connected: "checkingSupply" }
    | { connected: "supplyReached" }
    | { connected: "noFarmLoaded" }
    | { connected: "creatingFarm" }
    | { connected: "countdown" }
    | { connected: "readyToStart" }
    | { connected: "oauthorised" }
    | { connected: "authorised" }
    | { connected: "blacklisted" }
    | "airdropping"
    | { airdropping: "idle" }
    | { airdropping: "checking" }
    | { airdropping: "confirmation" }
    | { airdropping: "signing" }
    | { airdropping: "success" }
    | { airdropping: "error" }
    | { airdropping: "noFarm" }
    | { airdropping: "duplicate" }
    | "exploring"
    | "checkFarm"
    | "unauthorised";
  context: Context;
};

const API_URL = CONFIG.API_URL;

export type MachineInterpreter = Interpreter<
  Context,
  any,
  BlockchainEvent,
  BlockchainState
>;

export const authMachine = createMachine<
  Context,
  BlockchainEvent,
  BlockchainState
>(
  {
    id: "authMachine",
    initial: API_URL ? "connecting" : "visiting",
    context: {},
    states: {
      connecting: {
        id: "connecting",
        invoke: {
          src: "initMetamask",
          onDone: [
            // {
            //   target: "minimised",
            //   cond: () => !(window.screenTop === 0 && window.screenY === 0),
            // },
            {
              target: "checkFarm",
              cond: "hasFarmIdUrl",
            },
            {
              target: "oauthorising",
              cond: "hasDiscordCode",
            },
            { target: "signing" },
          ],
          onError: {
            target: "unauthorised",
            actions: "assignErrorMessage",
          },
        },
        on: {
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      signing: {
        invoke: {
          src: "login",
          onDone: {
            target: "connected",
            actions: "assignToken",
          },
          onError: {
            target: "unauthorised",
            actions: "assignErrorMessage",
          },
        },
        on: {
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      oauthorising: {
        invoke: {
          src: "oauthorise",
          onDone: {
            target: "connected.oauthorised",
            actions: "assignToken",
          },
          onError: {
            target: "unauthorised",
            actions: "assignErrorMessage",
          },
        },
        on: {
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      connected: {
        initial: "loadingFarm",
        states: {
          loadingFarm: {
            id: "loadingFarm",
            invoke: {
              src: "loadFarm",
              onDone: [
                {
                  target: "countdown",
                  cond: "isFresh",
                },
                {
                  target: "readyToStart",
                  actions: "assignFarm",
                  cond: "hasFarm",
                },
                { target: "checkingAccess" },
              ],
              onError: {
                target: "#unauthorised",
                actions: "assignErrorMessage",
              },
            },
          },
          checkingAccess: {
            id: "checkingAccess",
            invoke: {
              src: async (context) => {
                if (context.token?.userAccess.createFarm) {
                  return {
                    hasAccess: true,
                  };
                }

                // Only give access to V1 farmers
                const hasAccess = await metamask
                  .getSunflowerFarmers()
                  ?.hasV1Data();

                return {
                  hasAccess,
                };
              },
              onDone: [
                {
                  target: "noFarmLoaded",
                  cond: (_, event) => event.data.hasAccess,
                },
                { target: "checkingSupply" },
              ],
              onError: {
                target: "#unauthorised",
                actions: "assignErrorMessage",
              },
            },
          },
          checkingSupply: {
            id: "checkingSupply",
            invoke: {
              src: async () => {
                const totalSupply = await metamask.getFarm()?.getTotalSupply();

                return {
                  totalSupply,
                };
              },
              onDone: [
                {
                  target: "supplyReached",
                  cond: (context, event) =>
                    Number(event.data.totalSupply) >= 100000 &&
                    !context.token?.userAccess?.createFarm,
                },
                { target: "noFarmLoaded" },
              ],
              onError: {
                target: "#unauthorised",
                actions: "assignErrorMessage",
              },
            },
          },
          oauthorised: {
            on: {
              CREATE_FARM: {
                target: "creatingFarm",
              },
              REFRESH: {
                target: "#connecting",
              },
            },
          },
          creatingFarm: {
            invoke: {
              src: "createFarm",
              onDone: {
                target: "#connecting",
              },
              onError: {
                target: "#unauthorised",
                actions: "assignErrorMessage",
              },
            },
          },
          countdown: {
            on: {
              REFRESH: {
                target: "#connecting",
              },
            },
          },
          noFarmLoaded: {
            on: {
              CREATE_FARM: {
                target: "oauthorised",
              },
              CONNECT_TO_DISCORD: {
                // Redirects to Discord OAuth so no need for a state change
                target: "noFarmLoaded",
                actions: redirectOAuth,
              },
              EXPLORE: {
                target: "#exploring",
              },
            },
          },
          farmLoaded: {
            always: {
              target: "readyToStart",
            },
          },
          readyToStart: {
            on: {
              START_GAME: [
                {
                  cond: (context) => !!context.isBlacklisted,
                  target: "blacklisted",
                },
                {
                  target: "authorised",
                },
              ],
              EXPLORE: {
                target: "#exploring",
              },
            },
          },
          blacklisted: {
            on: {
              CONTINUE: "authorised",
            },
          },
          authorised: {
            on: {
              REFRESH: {
                target: "#connecting",
              },
              EXPLORE: {
                target: "#exploring",
              },
              LOGOUT: {
                target: "#connecting",
                actions: ["clearSession", "resetFarm"],
              },
            },
          },
          supplyReached: {},
        },
        on: {
          AIRDROP: "airdropping",
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      unauthorised: {
        id: "unauthorised",
        on: {
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      exploring: {
        id: "exploring",
        on: {
          LOAD_FARM: {
            target: "#loadingFarm",
          },
          VISIT: {
            target: "checkFarm",
          },
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      // An anonymous user is visiting a farm
      checkFarm: {
        invoke: {
          src: "visitFarm",
          onDone: [
            {
              target: "blacklisted",
              cond: (context) => !!context.isBlacklisted,
              actions: "assignFarm",
            },
            {
              target: "visiting",
              actions: "assignFarm",
              cond: "hasFarm",
            },
          ],
          onError: {
            target: "unauthorised",
            actions: "assignErrorMessage",
          },
        },
        on: {
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      blacklisted: {
        on: {
          CONTINUE: "visiting",
        },
      },
      visiting: {
        on: {
          RETURN: {
            target: "connecting",
            actions: ["resetFarm", "deleteFarmIdUrl"],
          },
          ACCOUNT_CHANGED: {
            target: "connecting",
            actions: "resetFarm",
          },
        },
      },
      minimised: {},
      airdropping: {
        initial: "idle",
        states: {
          idle: {
            on: {
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
          checking: {
            id: "checking",
            invoke: {
              src: async () => {
                const account = await metamask.getAccount();

                // On the same account they started with
                if (account === metamask.myAccount) {
                  return { isSameAccount: true };
                }

                // Check if they have a farm or tokens from V1
                const hasV1Data = await metamask
                  .getSunflowerFarmers()
                  .hasV1Data(account);

                return {
                  hasV1Data,
                };
              },
              onDone: [
                {
                  target: "idle",
                  cond: (_, event) => event.data.isSameAccount,
                },
                {
                  target: "confirmation",
                  cond: (_, event) => event.data.hasV1Data,
                },
                { target: "noFarm" },
              ],
              onError: {
                target: "error",
                actions: "assignErrorMessage",
              },
            },
            on: {
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
          noFarm: {
            on: {
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
          confirmation: {
            on: {
              CONFIRM: {
                target: "signing",
              },
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
          signing: {
            id: "airdropSigning",
            invoke: {
              src: async (context) => {
                const account = await metamask.getAccount();

                const { status } = await airdrop({
                  token: context.rawToken as string,
                  farmId: context.farmId as number,
                  fromAddress: account,
                });

                return { status };
              },
              onDone: [
                {
                  target: "duplicate",
                  cond: (_, event) => event.data.status === "already_migrated",
                },
                { target: "success" },
              ],
              onError: {
                target: "error",
                actions: "assignErrorMessage",
              },
            },
            on: {
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
          success: {},
          error: {},
          duplicate: {
            on: {
              ACCOUNT_CHANGED: {
                target: "#checking",
              },
            },
          },
        },
      },
    },
    on: {
      NETWORK_CHANGED: {
        target: "connecting",
        actions: "resetFarm",
      },
      REFRESH: {
        target: "connecting",
        actions: "resetFarm",
      },
    },
  },
  {
    services: {
      initMetamask: async (): Promise<void> => {
        await metamask.initialise();
      },
      loadFarm: async (): Promise<Farm | undefined> => {
        const farmAccounts = await metamask.getFarm()?.getFarms();
        if (farmAccounts?.length === 0) {
          return;
        }

        const createdAt = await metamask
          .getBeta()
          ?.getCreatedAt(metamask.myAccount as string);

        // V1 just support 1 farm per account - in future let them choose between the NFTs they hold
        const farmAccount = farmAccounts[0];

        const sessionId = await metamask
          .getSessionManager()
          .getSessionId(farmAccount.tokenId);

        const isBlacklisted = await isFarmBlacklisted(farmAccount.tokenId);

        return {
          farmId: farmAccount.tokenId,
          address: farmAccount.account,
          sessionId,
          createdAt,
          isBlacklisted,
        };
      },
      createFarm: async (context: Context, event: any): Promise<Context> => {
        const { charityAddress, donation, captcha } = event as CreateFarmEvent;

        const newFarm = await createFarmAction({
          charity: charityAddress,
          donation,
          token: context.rawToken as string,
          captcha: captcha,
        });

        return {
          farmId: newFarm.tokenId,
          address: newFarm.account,
          sessionId: INITIAL_SESSION,
        };
      },
      login: async (): Promise<{ token: string }> => {
        const { token } = await login();

        return {
          token,
        };
      },
      oauthorise: async () => {
        const code = getDiscordCode() as string;
        // Navigates to Discord OAuth Flow
        const { token } = await oauthorise(code);

        return { token };
      },
      visitFarm: async (
        _context: Context,
        event: any
      ): Promise<Farm | undefined> => {
        const farmId = getFarmUrl() || (event as VisitEvent).farmId;
        const farmAccount = await metamask.getFarm()?.getFarm(farmId);

        const isBlacklisted = await isFarmBlacklisted(farmId);

        return {
          farmId: farmAccount.tokenId,
          address: farmAccount.account,
          sessionId: "",
          createdAt: 0,
          isBlacklisted,
        };
      },
    },
    actions: {
      assignFarm: assign<Context, any>({
        farmId: (_context, event) => event.data.farmId,
        address: (_context, event) => event.data.address,
        sessionId: (_context, event) => event.data.sessionId,
        isBlacklisted: (_context, event) => event.data.isBlacklisted,
      }),
      assignToken: assign<Context, any>({
        token: (_context, event) => decodeToken(event.data.token),
        rawToken: (_context, event) => event.data.token,
      }),
      assignErrorMessage: assign<Context, any>({
        errorCode: (_context, event) => event.data.message,
      }),
      resetFarm: assign<Context, any>({
        farmId: () => undefined,
        address: () => undefined,
        sessionId: () => undefined,
        token: () => undefined,
        rawToken: () => undefined,
      }),
      clearSession: (context) => removeSession(metamask.myAccount as string),
      deleteFarmIdUrl: deleteFarmUrl,
    },
    guards: {
      isFresh: (context: Context, event: any) => {
        if (!event.data?.farmId) {
          return false;
        }

        const secondsElapsed =
          Date.now() / 1000 - (event.data as Farm).createdAt;
        return secondsElapsed < 60;
      },
      hasFarm: (context: Context, event: any) => {
        // If coming from the loadingFarm transition the farmId with show up on the event
        // else we check for it on the context
        if (event.data?.farmId) {
          const { farmId } = event.data;

          return !!farmId;
        }

        return !!context.farmId;
      },
      hasFarmIdUrl: () => !isNaN(getFarmUrl()),
      hasDiscordCode: () => !!getDiscordCode(),
    },
  }
);
