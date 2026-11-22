import { useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Label,
  Modal,
  ModalOverlay,
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components";
import type { DeskVolunteer } from "@vision/contracts";
import { classNames } from "../classNames.js";
import styles from "./MemberPicker.module.css";

const cx = classNames(styles);

export type MemberPickerProps = {
  title: string;
  volunteers: DeskVolunteer[];
  preselect: string | null;
  onPick: (member: string) => void;
  onClose: () => void;
};

export function volunteersFirstOn(volunteers: DeskVolunteer[]): DeskVolunteer[] {
  return [...volunteers].sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
}

function MemberList({
  volunteers,
  value,
  onChange,
}: {
  volunteers: DeskVolunteer[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (volunteers.length === 0) return <p className={cx("muted")}>No volunteers on the desk board.</p>;
  return (
    <RadioGroup className={cx("list")} value={value} onChange={onChange}>
      <Label className={cx("label")}>Volunteer</Label>
      {volunteers.map((volunteer) => (
        <RadioField key={volunteer.member} value={volunteer.member}>
          <RadioButton className={cx("option")}>
            <span className={cx("name")}>{volunteer.name}</span>
            <span className={cx("meta")}>{volunteer.on ? "ON" : "OFF"}</span>
            <code className={cx("meta")}>{volunteer.zone ?? "-----"}</code>
            <span className={cx("skills")}>
              {volunteer.skills.length === 0 ? "No skills" : volunteer.skills.join(", ")}
            </span>
            <span className={cx("meta")}>{`${String(volunteer.openJobs)} open`}</span>
          </RadioButton>
        </RadioField>
      ))}
    </RadioGroup>
  );
}

type ActionsProps = { value: string | null; onPick: (member: string) => void; onClose: () => void };

function PickerActions({ value, onPick, onClose }: ActionsProps) {
  return (
    <>
      <div className={cx("actions")}>
        <Button
          className={cx("primary")}
          isDisabled={value === null}
          onPress={() => {
            if (value !== null) onPick(value);
          }}
        >
          Confirm
        </Button>
        <Button className={cx("ghost")} onPress={onClose}>
          Cancel
        </Button>
      </div>
      {value === null ? <p className={cx("muted")}>Pick a volunteer first</p> : null}
    </>
  );
}

export function MemberPicker({ title, volunteers, preselect, onPick, onClose }: MemberPickerProps) {
  const [value, setValue] = useState<string | null>(preselect);
  return (
    <ModalOverlay
      className={cx("overlay")}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={cx("modal")}>
        <Dialog className={cx("dialog")}>
          <Heading slot="title" className={cx("title")}>
            {title}
          </Heading>
          <MemberList volunteers={volunteersFirstOn(volunteers)} value={value} onChange={setValue} />
          <PickerActions value={value} onPick={onPick} onClose={onClose} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
