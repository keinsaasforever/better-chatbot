"use client";
import { DBWorkflow } from "app-types/workflow";
import { generateUUID } from "lib/utils";
import { create } from "zustand";

export interface WorkflowState {
  workflow?: DBWorkflow;
  processIds: string[];
  hasEditAccess?: boolean;
}

export interface WorkflowDispatch {
  init: (workflow?: DBWorkflow, hasEditAccess?: boolean) => void;
  addProcess: () => () => void;
}

const initialState: WorkflowState = {
  processIds: [],
};

export const useWorkflowStore = create<WorkflowState & WorkflowDispatch>(
  (set) => ({
    ...initialState,
    init: (workflow, hasEditAccess) =>
      set({ ...initialState, workflow, hasEditAccess }),
    addProcess: () => {
      const processId = generateUUID();
      set((state) => ({
        processIds: [...state.processIds, processId],
      }));
      return () => {
        set((state) => ({
          processIds: state.processIds.filter((id) => id !== processId),
        }));
      };
    },
  }),
);
