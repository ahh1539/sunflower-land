import React, { useContext, useState } from "react";

import close from "assets/icons/close.png";
import chicken from "assets/resources/chicken.png";
import coop from "assets/nfts/chicken_coop.png";

import { Panel } from "components/ui/Panel";
import { Tab } from "components/ui/Tab";
import { ANIMALS, BARN_ITEMS } from "features/game/types/craftables";
import { CraftingItems } from "features/farming/blacksmith/components/CraftingItems";
import { Rare } from "features/farming/blacksmith/components/Rare";
import * as Auth from "features/auth/lib/Provider";
import { useActor } from "@xstate/react";

interface Props {
  onClose: () => void;
}

export const BarnSale: React.FC<Props> = ({ onClose }) => {
  const { authService } = useContext(Auth.Context);
  const [authState] = useActor(authService);

  return (
    <Panel className="pt-5 relative">
      <div className="flex justify-between absolute top-1.5 left-0.5 right-0 items-center">
        <img
          src={close}
          className="h-6 cursor-pointer mr-2 mb-1"
          onClick={onClose}
        />
      </div>

      <div
        style={{
          minHeight: "200px",
        }}
      >
        <Rare
          items={BARN_ITEMS}
          onClose={onClose}
          hasAccess={!!authState.context.token?.userAccess.mintCollectible}
        />
      </div>
    </Panel>
  );
};
