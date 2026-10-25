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
  describedStack: string | null,
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
      describedStack: null,
      frames: getStackFramesByFiber(source),
    };
    CapturedStacks.set(value, captured);
    return captured;
  } else {
    return {
      value,
      source,
      describedStack: null,
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
    describedStack: stack,
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
      captured.describedStack = describeStackFrames(frames);
    } finally {
      ReactSharedInternals.H = previousDispatcher;
    }
  }
  return captured.describedStack;
}

// Makes errorInfo.componentStack describe the captured stack on first read.
// The first read or a write turns it into a plain data property, so a logged
// errorInfo shows the stack and does not keep the captured value alive.
export function withLazyComponentStack<T: {componentStack: ?string, ...}>(
  errorInfo: T,
  captured: null | CapturedValue<mixed>,
  emptyStack: null | string,
): T {
  Object.defineProperty(errorInfo, 'componentStack', {
    configurable: true,
    enumerable: true,
    get() {
      const stack = captured === null ? null : getCapturedStack(captured);
      const componentStack = stack !== null ? stack : emptyStack;
      setComponentStack(errorInfo, componentStack);
      return componentStack;
    },
    set(componentStack: ?string) {
      setComponentStack(errorInfo, componentStack);
    },
  });
  return errorInfo;
}

function setComponentStack(errorInfo: Object, componentStack: ?string): void {
  Object.defineProperty(errorInfo, 'componentStack', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: componentStack,
  });
}
