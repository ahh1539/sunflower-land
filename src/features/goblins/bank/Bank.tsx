import React, { useContext } from "react";
import { useActor } from "@xstate/react";
import { Modal } from "react-bootstrap";
import classNames from "classnames";

import { Context } from "features/game/GoblinProvider";

import bank from "assets/buildings/bank.gif";
import token from "assets/icons/token.gif";

import { Action } from "components/ui/Action";
import { GRID_WIDTH_PX } from "features/game/lib/constants";
import { BankModal } from "./components/BankModal";
import { bankAudio } from "lib/utils/sfx";

export const Bank: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);

  const openBank = () => {
    setIsOpen(true);
    bankAudio.play();
  };

  return (
    <div
      className="z-10 absolute"
      style={{
        width: `${GRID_WIDTH_PX * 2.7}px`,
        right: `${GRID_WIDTH_PX * 10}px`,
        top: `${GRID_WIDTH_PX * 25}px`,
      }}
    >
      <div className="cursor-pointer hover:img-highlight">
        <img src={bank} alt="bank" onClick={openBank} className="w-full" />
        <Action
          className="absolute -bottom-6 left-2"
          text="Bank"
          icon={token}
          onClick={openBank}
        />
      </div>

      <Modal show={isOpen} onHide={() => setIsOpen(false)} centered>
        <BankModal onClose={() => setIsOpen(false)} />
      </Modal>
    </div>
  );
};
