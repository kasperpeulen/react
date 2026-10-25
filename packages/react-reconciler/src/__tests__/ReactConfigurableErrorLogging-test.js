/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let Scheduler;
let container;
let act;

async function fakeAct(cb) {
  // We don't use act/waitForThrow here because we want to observe how errors are reported for real.
  await cb();
  Scheduler.unstable_flushAll();
}

describe('ReactConfigurableErrorLogging', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    container = document.createElement('div');
    if (__DEV__) {
      act = React.act;
    }
  });

  it('should log errors that occur during the begin phase', async () => {
    class ErrorThrowingComponent extends React.Component {
      constructor(props) {
        super(props);
        throw new Error('constructor error');
      }
      render() {
        return <div />;
      }
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });
    await fakeAct(() => {
      root.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([
      expect.objectContaining({
        message: 'constructor error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
      }),
    ]);
    expect(caughtErrors).toEqual([]);
  });

  it('should log errors that occur during the commit phase', async () => {
    class ErrorThrowingComponent extends React.Component {
      componentDidMount() {
        throw new Error('componentDidMount error');
      }
      render() {
        return <div />;
      }
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });
    await fakeAct(() => {
      root.render(
        <div>
          <span>
            <ErrorThrowingComponent />
          </span>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([
      expect.objectContaining({
        message: 'componentDidMount error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
      }),
    ]);
    expect(caughtErrors).toEqual([]);
  });

  it('should ignore errors thrown in log method to prevent cycle', async () => {
    class ErrorBoundary extends React.Component {
      state = {error: null};
      componentDidCatch(error) {
        this.setState({error});
      }
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    class ErrorThrowingComponent extends React.Component {
      render() {
        throw new Error('render error');
      }
    }

    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
        throw new Error('onCaughtError error');
      },
    });

    const ref = React.createRef();

    await fakeAct(() => {
      root.render(
        <div>
          <ErrorBoundary ref={ref}>
            <span>
              <ErrorThrowingComponent />
            </span>
          </ErrorBoundary>
        </div>,
      );
    });

    expect(uncaughtErrors).toEqual([]);
    expect(caughtErrors).toEqual([
      expect.objectContaining({
        message: 'render error',
      }),
      expect.objectContaining({
        componentStack: expect.stringMatching(
          new RegExp(
            '\\s+(in|at) ErrorThrowingComponent (.*)\n' +
              '\\s+(in|at) span(.*)\n' +
              '\\s+(in|at) ErrorBoundary(.*)\n' +
              '\\s+(in|at) div(.*)',
          ),
        ),
        errorBoundary: ref.current,
      }),
    ]);

    // The error thrown in caughtError should be rethrown with a clean stack
    expect(() => {
      jest.runAllTimers();
    }).toThrow('onCaughtError error');
  });

  it('describes the component stack of a caught error only when it is read', async () => {
    class ErrorBoundary extends React.Component {
      state = {error: null};
      static getDerivedStateFromError(error) {
        return {error};
      }
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    // Describing a function component's frame calls it without props.
    let describedParent = 0;
    function Parent(props) {
      if (props === undefined) {
        describedParent++;
      }
      return props.children;
    }
    function ErrorThrowingComponent() {
      throw new Error('render error');
    }

    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });

    await fakeAct(() => {
      root.render(
        <ErrorBoundary>
          <Parent>
            <ErrorThrowingComponent />
          </Parent>
        </ErrorBoundary>,
      );
    });

    expect(caughtErrors.length).toBe(2);
    expect(describedParent).toBe(0);

    const errorInfo = caughtErrors[1];
    expect(errorInfo.componentStack).toMatch(
      new RegExp(
        '\\s+(in|at) ErrorThrowingComponent(.*)\n' +
          '\\s+(in|at) Parent(.*)\n' +
          '\\s+(in|at) ErrorBoundary(.*)',
      ),
    );
    expect(describedParent).toBe(1);
    // The first read turned it into a plain, writable data property.
    expect(
      Object.getOwnPropertyDescriptor(errorInfo, 'componentStack'),
    ).toEqual(
      expect.objectContaining({value: expect.any(String), writable: true}),
    );
    errorInfo.componentStack = 'replaced';
    expect(errorInfo.componentStack).toBe('replaced');
    expect(describedParent).toBe(1);
  });

  it('describes a caught component stack read during a render without reaching its hooks', async () => {
    class ErrorBoundary extends React.Component {
      state = {error: null};
      static getDerivedStateFromError(error) {
        return {error};
      }
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    function Parent(props) {
      React.useState('x');
      return props.children;
    }
    function ErrorThrowingComponent() {
      throw new Error('render error');
    }

    let caughtInfo = null;
    const root = ReactDOMClient.createRoot(container, {
      onCaughtError(error, errorInfo) {
        caughtInfo = errorInfo;
      },
    });
    await fakeAct(() => {
      root.render(
        <ErrorBoundary>
          <Parent>
            <ErrorThrowingComponent />
          </Parent>
        </ErrorBoundary>,
      );
    });

    let setFirst;
    let stack;
    function Reader() {
      const [first, setState] = React.useState('a');
      setFirst = setState;
      stack = caughtInfo.componentStack;
      const [second] = React.useState('t');
      return first + second;
    }
    const readerContainer = document.createElement('div');
    const readerRoot = ReactDOMClient.createRoot(readerContainer);
    await fakeAct(() => {
      readerRoot.render(<Reader />);
    });
    expect(stack).toMatch(/\s+(in|at) Parent/);
    expect(readerContainer.textContent).toBe('at');

    await fakeAct(() => {
      setFirst('b');
    });
    expect(readerContainer.textContent).toBe('bt');
  });

  it('does not log errors when inside real act', async () => {
    function ErrorThrowingComponent() {
      throw new Error('render error');
    }
    const uncaughtErrors = [];
    const caughtErrors = [];
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push(error, errorInfo);
      },
      onCaughtError(error, errorInfo) {
        caughtErrors.push(error, errorInfo);
      },
    });

    if (__DEV__) {
      global.IS_REACT_ACT_ENVIRONMENT = true;

      await expect(async () => {
        await act(() => {
          root.render(
            <div>
              <span>
                <ErrorThrowingComponent />
              </span>
            </div>,
          );
        });
      }).rejects.toThrow('render error');
    }

    expect(uncaughtErrors).toEqual([]);
    expect(caughtErrors).toEqual([]);
  });
});
