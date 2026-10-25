/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {ComponentStackFrames} from './ReactFiberComponentStack';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {
  getStackFramesByFiber,
  describeStackFrames,
} from './ReactFiberComponentStack';

const CapturedStacks: WeakMap<any, CapturedValue<any>> = new WeakMap();

export type CapturedValue<+T> = {
  +value: T,
  source: Fiber | null,
  // The component stack is described on first read: most caught errors are
  // never logged with their stack, and describing it calls every component in
  // it. Read it with getCapturedStack().
  stack: string | null,
  frames: ComponentStackFrames | null,
};

export function createCapturedValueAtFiber<T>(
  value: T,
  source: Fiber,
): CapturedValue<T> {
  // If the value is an error, call this function immediately after it is thrown
  // so the stack is accurate.
  // $FlowFixMe[invalid-compare]
  if (typeof value === 'object' && value !== null) {
    const existing = CapturedStacks.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const captured: CapturedValue<T> = {
      value,
      source,
      stack: null,
      frames: getStackFramesByFiber(source),
    };
    CapturedStacks.set(value, captured);
    return captured;
  } else {
    return {
      value,
      source,
      stack: null,
      frames: getStackFramesByFiber(source),
    };
  }
}

export function createCapturedValueFromError(
  value: Error,
  stack: null | string,
): CapturedValue<Error> {
  const captured: CapturedValue<Error> = {
    value,
    source: null,
    stack: stack,
    frames: null,
  };
  if (typeof stack === 'string') {
    CapturedStacks.set(value, captured);
  }
  return captured;
}

export function getCapturedStack(
  captured: CapturedValue<mixed>,
): string | null {
  const frames = captured.frames;
  if (frames !== null) {
    captured.frames = null;
    // Describing a frame calls its component. The stack may be read inside
    // another component's render, whose hooks the call must not reach.
    const previousDispatcher = ReactSharedInternals.H;
    ReactSharedInternals.H = null;
    try {
      captured.stack = describeStackFrames(frames);
    } finally {
      ReactSharedInternals.H = previousDispatcher;
    }
  }
  return captured.stack;
}
