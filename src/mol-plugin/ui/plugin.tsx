/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import * as React from 'react';
import { PluginContext } from '../context';
import { StateTree } from './state-tree';
import { Viewport, ViewportControls } from './viewport';
import { Controls, TrajectoryControls } from './controls';
import { PluginComponent, PluginReactContext } from './base';
import { CameraSnapshots } from './camera';
import { StateSnapshots } from './state';
import { List } from 'immutable';
import { LogEntry } from 'mol-util/log-entry';
import { formatTime } from 'mol-util';
import { BackgroundTaskProgress } from './task';
import { ApplyActionContol } from './state/apply-action';
import { PluginState } from 'mol-plugin/state';
import { UpdateTransformContol } from './state/update-transform';

export class Plugin extends React.Component<{ plugin: PluginContext }, {}> {
    render() {
        return <PluginReactContext.Provider value={this.props.plugin}>
            <div style={{ position: 'absolute', width: '100%', height: '100%', fontFamily: 'monospace' }}>
                <div style={{ position: 'absolute', width: '350px', height: '100%', overflowY: 'scroll', padding: '10px' }}>
                    <State />
                </div>
                <div style={{ position: 'absolute', left: '350px', right: '300px', top: '0', bottom: '100px' }}>
                    <Viewport />
                    <div style={{ position: 'absolute', left: '10px', top: '10px', height: '100%', color: 'white' }}>
                        <TrajectoryControls />
                    </div>
                    <ViewportControls />
                    <div style={{ position: 'absolute', left: '10px', bottom: '10px', color: 'white' }}>
                        <BackgroundTaskProgress />
                    </div>
                </div>
                <div style={{ position: 'absolute', width: '300px', right: '0', top: '0', bottom: '0', padding: '10px', overflowY: 'scroll' }}>
                    <CurrentObject />
                    <hr />
                    <Controls />
                    <hr />
                    <CameraSnapshots />
                    <hr />
                    <StateSnapshots />
                </div>
                <div style={{ position: 'absolute', right: '300px', left: '350px', bottom: '0', height: '100px', overflow: 'hidden' }}>
                    <Log />
                </div>
            </div>
        </PluginReactContext.Provider>;
    }
}

export class State extends PluginComponent {
    componentDidMount() {
        this.subscribe(this.plugin.state.behavior.kind, () => this.forceUpdate());
    }

    set(kind: PluginState.Kind) {
        // TODO: do command for this?
        this.plugin.state.setKind(kind);
    }

    render() {
        const kind = this.plugin.state.behavior.kind.value;
        return <>
            <button onClick={() => this.set('data')} style={{ fontWeight: kind === 'data' ? 'bold' : 'normal'}}>Data</button>
            <button onClick={() => this.set('behavior')} style={{ fontWeight: kind === 'behavior' ? 'bold' : 'normal'}}>Behavior</button>
            <StateTree state={kind === 'data' ? this.plugin.state.dataState : this.plugin.state.behaviorState} />
        </>
    }
}

export class Log extends PluginComponent<{}, { entries: List<LogEntry> }> {
    private wrapper = React.createRef<HTMLDivElement>();

    componentDidMount() {
        this.subscribe(this.plugin.events.log, e => this.setState({ entries: this.state.entries.push(e) }));
    }

    componentDidUpdate() {
        this.scrollToBottom();
    }

    state = { entries: List<LogEntry>() };

    private scrollToBottom() {
        const log = this.wrapper.current;
        if (log) log.scrollTop = log.scrollHeight - log.clientHeight - 1;
    }

    render() {
        return <div ref={this.wrapper} style={{ position: 'absolute', top: '0', right: '0', bottom: '0', left: '0', padding: '10px', overflowY: 'scroll' }}>
            <ul style={{ listStyle: 'none' }}>
                {this.state.entries.map((e, i) => <li key={i} style={{ borderBottom: '1px solid #999', padding: '3px' }}>
                    [{e!.type}] [{formatTime(e!.timestamp)}] {e!.message}
                </li>)}
            </ul>
        </div>;
    }
}

export class CurrentObject extends PluginComponent {
    get current() {
        return this.plugin.state.behavior.currentObject.value;
    }

    componentDidMount() {
        this.subscribe(this.plugin.state.behavior.currentObject, o => {
            this.forceUpdate();
        });

        this.subscribe(this.plugin.events.state.object.updated, ({ ref, state }) => {
            const current = this.current;
            if (current.ref !== ref || current.state !== state) return;
            this.forceUpdate();
        });
    }

    render() {
        const current = this.current;

        const ref = current.ref;
        // const n = this.props.plugin.state.data.tree.nodes.get(ref)!;
        const obj = current.state.cells.get(ref)!;

        const type = obj && obj.obj ? obj.obj.type : void 0;

        const transform = current.state.tree.transforms.get(ref);

        const actions = type
            ? current.state.actions.fromType(type)
            : []
        return <div>
            <hr />
            <h3>{obj.obj ? obj.obj.label : ref}</h3>
            <UpdateTransformContol state={current.state} transform={transform} />
            <hr />
            <h3>Create</h3>
            {
                actions.map((act, i) => <ApplyActionContol plugin={this.plugin} key={`${act.id}`} state={current.state} action={act} nodeRef={ref} />)
            }
        </div>;
    }
}