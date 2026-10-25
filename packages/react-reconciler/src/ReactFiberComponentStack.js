/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableViewTransition} from 'shared/ReactFeatureFlags';
import type {Fiber} from './ReactInternalTypes';
import type {ReactComponentInfo} from 'shared/ReactTypes';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  LazyComponent,
  SuspenseComponent,
  SuspenseListComponent,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
  ClassComponent,
  HostText,
  ViewTransitionComponent,
  ActivityComponent,
} from './ReactWorkTags';
import {
  describeBuiltInComponentFrame,
  describeFunctionComponentFrame,
  describeClassComponentFrame,
  describeDebugInfoFrame,
} from 'shared/ReactComponentStackFrame';
import {formatOwnerStack} from 'shared/ReactOwnerStackFrames';
import isArray from 'shared/isArray';

function describeFrame(
  tag: Fiber['tag'],
  type: Fiber['type'],
  inSuspenseFallback: boolean,
): string {
  switch (tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      return describeBuiltInComponentFrame(type);
    case LazyComponent:
      // TODO: When we support Thenables as component types we should rename this.
      return describeBuiltInComponentFrame('Lazy');
    case SuspenseComponent:
      if (inSuspenseFallback) {
        // If we came from the second Fiber then we're in the Suspense Fallback.
        return describeBuiltInComponentFrame('Suspense Fallback');
      }
      return describeBuiltInComponentFrame('Suspense');
    case SuspenseListComponent:
      return describeBuiltInComponentFrame('SuspenseList');
    case FunctionComponent:
    case SimpleMemoComponent:
      return describeFunctionComponentFrame(type);
    case ForwardRef:
      return describeFunctionComponentFrame(type.render);
    case ClassComponent:
      return describeClassComponentFrame(type);
    case ActivityComponent:
      return describeBuiltInComponentFrame('Activity');
    case ViewTransitionComponent:
      if (enableViewTransition) {
        return describeBuiltInComponentFrame('ViewTransition');
      }
    // Fallthrough
    default:
      return '';
  }
}

// The ancestors of a fiber, recorded without describing them. Describing a
// function or class component calls it to read a native stack frame, which is
// the costly part of a component stack, so a caller that may never read the
// stack records the frames and describes them later.
export opaque type ComponentStackFrames = Array<
  [Fiber['tag'], Fiber['type'], boolean] | ReactComponentInfo,
>;

export function getStackFramesByFiber(
  workInProgress: Fiber,
): ComponentStackFrames {
  const frames: ComponentStackFrames = [];
  let node: Fiber = workInProgress;
  let previous: null | Fiber = null;
  do {
    frames.push([
      node.tag,
      node.type,
      node.child !== previous && previous !== null,
    ]);
    if (__DEV__) {
      // Add any Server Component stack frames in reverse order.
      const debugInfo = node._debugInfo;
      if (debugInfo) {
        for (let i = debugInfo.length - 1; i >= 0; i--) {
          const entry = debugInfo[i];
          if (typeof entry.name === 'string') {
            frames.push(entry as any);
          }
        }
      }
    }
    previous = node;
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    node = node.return;
  } while (node);
  return frames;
}

export function describeStackFrames(frames: ComponentStackFrames): string {
  try {
    let info = '';
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (isArray(frame)) {
        info += describeFrame(frame[0], frame[1], frame[2]);
      } else if (__DEV__) {
        info += describeDebugInfoFrame(
          frame.name as any,
          frame.env,
          frame.debugLocation,
        );
      }
    }
    return info;
  } catch (x) {
    return '\nError generating stack: ' + x.message + '\n' + x.stack;
  }
}

export function getStackByFiberInDevAndProd(workInProgress: Fiber): string {
  return describeStackFrames(getStackFramesByFiber(workInProgress));
}

function describeFunctionComponentFrameWithoutLineNumber(fn: Function): string {
  // We use this because we don't actually want to describe the line of the component
  // but just the component name.
  const name = fn ? fn.displayName || fn.name : '';
  return name ? describeBuiltInComponentFrame(name) : '';
}

export function getOwnerStackByFiberInDev(workInProgress: Fiber): string {
  if (!__DEV__) {
    return '';
  }
  try {
    let info = '';

    if (workInProgress.tag === HostText) {
      // Text nodes never have an owner/stack because they're not created through JSX.
      // We use the parent since text nodes are always created through a host parent.
      workInProgress = workInProgress.return as any;
    }

    // The owner stack of the current fiber will be where it was created, i.e. inside its owner.
    // There's no actual name of the currently executing component. Instead, that is available
    // on the regular stack that's currently executing. However, for built-ins there is no such
    // named stack frame and it would be ignored as being internal anyway. Therefore we add
    // add one extra frame just to describe the "current" built-in component by name.
    // Similarly, if there is no owner at all, then there's no stack frame so we add the name
    // of the root component to the stack to know which component is currently executing.
    switch (workInProgress.tag) {
      case HostHoistable:
      case HostSingleton:
      case HostComponent:
        info += describeBuiltInComponentFrame(workInProgress.type);
        break;
      case SuspenseComponent:
        info += describeBuiltInComponentFrame('Suspense');
        break;
      case SuspenseListComponent:
        info += describeBuiltInComponentFrame('SuspenseList');
        break;
      case ActivityComponent:
        info += describeBuiltInComponentFrame('Activity');
        break;
      case ViewTransitionComponent:
        if (enableViewTransition) {
          info += describeBuiltInComponentFrame('ViewTransition');
          break;
        }
      // Fallthrough
      case FunctionComponent:
      case SimpleMemoComponent:
      case ClassComponent:
        if (!workInProgress._debugOwner && info === '') {
          // Only if we have no other data about the callsite do we add
          // the component name as the single stack frame.
          info += describeFunctionComponentFrameWithoutLineNumber(
            workInProgress.type,
          );
        }
        break;
      case ForwardRef:
        if (!workInProgress._debugOwner && info === '') {
          info += describeFunctionComponentFrameWithoutLineNumber(
            workInProgress.type.render,
          );
        }
        break;
    }

    let owner: void | null | Fiber | ReactComponentInfo = workInProgress;

    while (owner) {
      if (typeof owner.tag === 'number') {
        const fiber: Fiber = owner as any;
        owner = fiber._debugOwner;
        const debugStack = fiber._debugStack;
        // If we don't actually print the stack if there is no owner of this JSX element.
        // In a real app it's typically not useful since the root app is always controlled
        // by the framework. These also tend to have noisy stacks because they're not rooted
        // in a React render but in some imperative bootstrapping code. It could be useful
        // if the element was created in module scope. E.g. hoisted. We could add a a single
        // stack frame for context for example but it doesn't say much if that's a wrapper.
        if (owner && debugStack) {
          const formattedStack = formatOwnerStack(debugStack);
          if (formattedStack !== '') {
            info += '\n' + formattedStack;
          }
        }
      } else if (owner.debugStack != null) {
        // Server Component
        const ownerStack: Error = owner.debugStack;
        owner = owner.owner;
        if (owner && ownerStack) {
          // TODO: Should we stash this somewhere for caching purposes?
          info += '\n' + formatOwnerStack(ownerStack);
        }
      } else {
        break;
      }
    }
    return info;
  } catch (x) {
    return '\nError generating stack: ' + x.message + '\n' + x.stack;
  }
}
