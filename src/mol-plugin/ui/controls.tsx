/**
 * Copyright (c) 2018-2019 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import * as React from 'react';
import { PluginCommands } from '../../mol-plugin/command';
import { UpdateTrajectory } from '../../mol-plugin/state/actions/structure';
import { PluginUIComponent } from './base';
import { LociLabelEntry } from '../../mol-plugin/util/loci-label-manager';
import { IconButton, Icon } from './controls/common';
import { PluginStateObject } from '../../mol-plugin/state/objects';
import { StateTransforms } from '../../mol-plugin/state/transforms';
import { StateTransformer, StateSelection, StateObjectCell, StateTransform, StateBuilder } from '../../mol-state';
import { ModelFromTrajectory } from '../../mol-plugin/state/transforms/model';
import { AnimationControls } from './state/animation';
import { ParamDefinition as PD} from '../../mol-util/param-definition';
import { ColorNames } from '../../mol-util/color/tables';
import { ParameterControls } from './controls/parameters';
import { formatMolScript } from '../../mol-script/language/expression-formatter';
import { StructureElement, Structure, QueryContext, StructureSelection } from '../../mol-model/structure';
import { isEmptyLoci, EmptyLoci } from '../../mol-model/loci';
import { MolScriptBuilder } from '../../mol-script/language/builder';
import { PluginContext } from '../context';
import { StructureRepresentation3DHelpers } from '../state/transforms/representation';
import { parseMolScript } from '../../mol-script/language/parser';
import { transpileMolScript } from '../../mol-script/script/mol-script/symbols';
import { compile } from '../../mol-script/runtime/query/compiler';

export class TrajectoryViewportControls extends PluginUIComponent<{}, { show: boolean, label: string }> {
    state = { show: false, label: '' }

    private update = () => {
        const state = this.plugin.state.dataState;

        const models = state.selectQ(q => q.ofTransformer(StateTransforms.Model.ModelFromTrajectory));

        if (models.length === 0) {
            this.setState({ show: false });
            return;
        }

        let label = '', count = 0, parents = new Set<string>();
        for (const m of models) {
            if (!m.sourceRef) continue;
            const parent = state.cells.get(m.sourceRef)!.obj as PluginStateObject.Molecule.Trajectory;

            if (!parent) continue;
            if (parent.data.length > 1) {
                if (parents.has(m.sourceRef)) {
                    // do not show the controls if there are 2 models of the same trajectory present
                    this.setState({ show: false });
                }

                parents.add(m.sourceRef);
                count++;
                if (!label) {
                    const idx = (m.transform.params! as StateTransformer.Params<ModelFromTrajectory>).modelIndex;
                    label = `Model ${idx + 1} / ${parent.data.length}`;
                }
            }
        }

        if (count > 1) label = '';
        this.setState({ show: count > 0, label });
    }

    componentDidMount() {
        this.subscribe(this.plugin.state.dataState.events.changed, this.update);
        this.subscribe(this.plugin.behaviors.state.isAnimating, this.update);
    }

    reset = () => PluginCommands.State.ApplyAction.dispatch(this.plugin, {
        state: this.plugin.state.dataState,
        action: UpdateTrajectory.create({ action: 'reset' })
    });

    prev = () => PluginCommands.State.ApplyAction.dispatch(this.plugin, {
        state: this.plugin.state.dataState,
        action: UpdateTrajectory.create({ action: 'advance', by: -1 })
    });

    next = () => PluginCommands.State.ApplyAction.dispatch(this.plugin, {
        state: this.plugin.state.dataState,
        action: UpdateTrajectory.create({ action: 'advance', by: 1 })
    });

    // stopAnimation = () => {
    //     this.plugin.state.animation.stop();
    // }

    // playAnimation = () => {
    //     const anim = this.plugin.state.animation;
    //     if (anim.state.params.current === AnimateModelIndex.name) {
    //         anim.start();
    //     } else {
    //         anim.play(AnimateModelIndex, ParamDefinition.getDefaultValues(AnimateModelIndex.params(this.plugin) as any as ParamDefinition.Params))
    //     }
    // }

    render() {
        const isAnimating = this.plugin.behaviors.state.isAnimating.value;

        if (!this.state.show || (isAnimating && !this.state.label)) return null;

        return <div className='msp-traj-controls'>
            {/* <IconButton icon={isAnimating ? 'stop' : 'play'} title={isAnimating ? 'Stop' : 'Play'} onClick={isAnimating ? this.stopAnimation : this.playAnimation} /> */}
            {!isAnimating && <IconButton icon='model-first' title='First Model' onClick={this.reset} disabled={isAnimating} />}
            {!isAnimating && <IconButton icon='model-prev' title='Previous Model' onClick={this.prev} disabled={isAnimating} />}
            {!isAnimating && <IconButton icon='model-next' title='Next Model' onClick={this.next} disabled={isAnimating} />}
            {!!this.state.label && <span>{this.state.label}</span> }
        </div>;
    }
}

export class StateSnapshotViewportControls extends PluginUIComponent<{}, { isBusy: boolean, show: boolean }> {
    state = { isBusy: false, show: true }

    componentDidMount() {
        // TODO: this needs to be diabled when the state is updating!
        this.subscribe(this.plugin.state.snapshots.events.changed, () => this.forceUpdate());
        this.subscribe(this.plugin.behaviors.state.isUpdating, isBusy => this.setState({ isBusy }));
        this.subscribe(this.plugin.behaviors.state.isAnimating, isBusy => this.setState({ isBusy }))

        window.addEventListener('keyup', this.keyUp, false);
    }

    componentWillUnmount() {
        super.componentWillUnmount();
        window.removeEventListener('keyup', this.keyUp, false);
    }

    keyUp = (e: KeyboardEvent) => {
        if (!e.ctrlKey || this.state.isBusy || e.target !== document.body) return;
        const snapshots = this.plugin.state.snapshots;
        if (e.keyCode === 37) { // left
            if (snapshots.state.isPlaying) snapshots.stop();
            this.prev();
        } else if (e.keyCode === 38) { // up
            if (snapshots.state.isPlaying) snapshots.stop();
            if (snapshots.state.entries.size === 0) return;
            const e = snapshots.state.entries.get(0);
            this.update(e.snapshot.id);
        } else if (e.keyCode === 39) { // right
            if (snapshots.state.isPlaying) snapshots.stop();
            this.next();
        } else if (e.keyCode === 40) { // down
            if (snapshots.state.isPlaying) snapshots.stop();
            if (snapshots.state.entries.size === 0) return;
            const e = snapshots.state.entries.get(snapshots.state.entries.size - 1);
            this.update(e.snapshot.id);
        }
    };

    async update(id: string) {
        this.setState({ isBusy: true });
        await PluginCommands.State.Snapshots.Apply.dispatch(this.plugin, { id });
        this.setState({ isBusy: false });
    }

    change = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (e.target.value === 'none') return;
        this.update(e.target.value);
    }

    prev = () => {
        const s = this.plugin.state.snapshots;
        const id = s.getNextId(s.state.current, -1);
        if (id) this.update(id);
    }

    next = () => {
        const s = this.plugin.state.snapshots;
        const id = s.getNextId(s.state.current, 1);
        if (id) this.update(id);
    }

    togglePlay = () => {
        this.plugin.state.snapshots.togglePlay();
    }

    render() {
        const snapshots = this.plugin.state.snapshots;
        const count = snapshots.state.entries.size;

        if (count < 2 || !this.state.show) {
            return null;
        }

        const current = snapshots.state.current;
        const isPlaying = snapshots.state.isPlaying;

        return <div className='msp-state-snapshot-viewport-controls'>
            <select className='msp-form-control' value={current || 'none'} onChange={this.change} disabled={this.state.isBusy || isPlaying}>
                {!current && <option key='none' value='none'></option>}
                {snapshots.state.entries.valueSeq().map((e, i) => <option key={e!.snapshot.id} value={e!.snapshot.id}>{`[${i! + 1}/${count}]`} {e!.name || new Date(e!.timestamp).toLocaleString()}</option>)}
            </select>
            <IconButton icon={isPlaying ? 'stop' : 'play'} title={isPlaying ? 'Pause' : 'Cycle States'} onClick={this.togglePlay}
                disabled={isPlaying ? false : this.state.isBusy} />
            {!isPlaying && <>
                <IconButton icon='left-open' title='Previous State' onClick={this.prev} disabled={this.state.isBusy || isPlaying} />
                <IconButton icon='right-open' title='Next State' onClick={this.next} disabled={this.state.isBusy || isPlaying} />
            </>}
        </div>;
    }
}

export class AnimationViewportControls extends PluginUIComponent<{}, { isEmpty: boolean, isExpanded: boolean, isUpdating: boolean, isAnimating: boolean, isPlaying: boolean }> {
    state = { isEmpty: true, isExpanded: false, isUpdating: false, isAnimating: false, isPlaying: false };

    componentDidMount() {
        this.subscribe(this.plugin.state.snapshots.events.changed, () => {
            if (this.plugin.state.snapshots.state.isPlaying) this.setState({ isPlaying: true, isExpanded: false });
            else this.setState({ isPlaying: false });
        });
        this.subscribe(this.plugin.behaviors.state.isUpdating, isUpdating => {
            if (isUpdating) this.setState({ isUpdating: true, isExpanded: false, isEmpty: this.plugin.state.dataState.tree.transforms.size < 2 });
            else this.setState({ isUpdating: false, isEmpty: this.plugin.state.dataState.tree.transforms.size < 2 });
        });
        this.subscribe(this.plugin.behaviors.state.isAnimating, isAnimating => {
            if (isAnimating) this.setState({ isAnimating: true, isExpanded: false });
            else this.setState({ isAnimating: false });
        });
    }
    toggleExpanded = () => this.setState({ isExpanded: !this.state.isExpanded });
    stop = () => {
        this.plugin.state.animation.stop();
        this.plugin.state.snapshots.stop();
    }

    render() {
        // if (!this.state.show) return null;
        const isPlaying = this.plugin.state.snapshots.state.isPlaying;
        if (isPlaying) return null;

        const isAnimating = this.state.isAnimating;

        return <div className='msp-animation-viewport-controls'>
            <IconButton icon={isAnimating || isPlaying ? 'stop' : 'tape'} title={isAnimating ? 'Stop' : 'Select Animation'}
                onClick={isAnimating || isPlaying ? this.stop : this.toggleExpanded}
                disabled={isAnimating|| isPlaying ? false : this.state.isUpdating || this.state.isPlaying || this.state.isEmpty} />
            {(this.state.isExpanded && !this.state.isUpdating) && <div className='msp-animation-viewport-controls-select'>
                <AnimationControls onStart={this.toggleExpanded} />
            </div>}
        </div>;
    }
}

export class LociLabelControl extends PluginUIComponent<{}, { entries: ReadonlyArray<LociLabelEntry> }> {
    state = { entries: [] }

    componentDidMount() {
        this.subscribe(this.plugin.behaviors.labels.highlight, e => this.setState({ entries: e.entries }));
    }

    render() {
        if (this.state.entries.length === 0) return null;

        return <div className='msp-highlight-info'>
            {this.state.entries.map((e, i) => <div key={'' + i}>{e}</div>)}
        </div>;
    }
}

//

function getExpression(loci: StructureElement.Loci | EmptyLoci) {
    const scriptExpression = isEmptyLoci(loci)
        ? MolScriptBuilder.struct.generator.empty()
        : StructureElement.Loci.toScriptExpression(loci)
    return formatMolScript(scriptExpression)
}

type OverpaintEachReprCallback = (update: StateBuilder.Root, repr: StateObjectCell<PluginStateObject.Molecule.Structure.Representation3D, StateTransform<typeof StateTransforms.Representation.StructureRepresentation3D>>, rootStructure: Structure, overpaint?: StateObjectCell<any, StateTransform<typeof StateTransforms.Representation.OverpaintStructureRepresentation3D>>) => void
const OverpaintManagerTag = 'overpaint-controls'

export class OverpaintControls extends PluginUIComponent<{}, { params: PD.Values<ReturnType<typeof OverpaintControls.getParams>> }> {
    state = { params: PD.getDefaultValues(OverpaintControls.getParams(this.plugin)) }

    static getParams = (plugin: PluginContext) => {
        const { types } = plugin.structureRepresentation.registry
        return {
            color: PD.Color(ColorNames.cyan),
            type: PD.MultiSelect(types.map(t => t[0]), types)
        }
    }

    componentDidMount() {

    }

    private async eachRepr(callback: OverpaintEachReprCallback) {
        const state = this.plugin.state.dataState;
        const reprs = state.select(StateSelection.Generators.ofType(PluginStateObject.Molecule.Structure.Representation3D));

        const update = state.build();
        for (const r of reprs) {
            const overpaint = state.select(StateSelection.Generators.ofTransformer(StateTransforms.Representation.OverpaintStructureRepresentation3D, r.transform.ref).withTag(OverpaintManagerTag));

            const structure = r.obj!.data.source.data
            const rootStructure = structure.parent || structure

            callback(update, r, rootStructure, overpaint[0])
        }

        await this.plugin.runTask(state.updateTree(update, { doNotUpdateCurrent: true }));
    }

    set = async (clear: boolean) => {
        await this.eachRepr((update, repr, rootStructure, overpaint) => {
            if (!this.state.params.type.includes(repr.params!.values.type.name)) return

            const loci = this.plugin.helpers.structureSelection.get(rootStructure)
            if (isEmptyLoci(loci) || loci.elements.length === 0) return
            const expression = getExpression(loci)

            const layer = {
                script: { language: 'mol-script', expression },
                color: this.state.params.color,
                clear
            }

            if (overpaint) {
                update.to(overpaint).update({ layers: [ ...overpaint.params!.values.layers, layer ], alpha: 1 })
            } else {
                update.to(repr.transform.ref)
                    .apply(StateTransforms.Representation.OverpaintStructureRepresentation3D, { layers: [ layer ], alpha: 1 }, { tags: OverpaintManagerTag });
            }
        })
    }

    add = async () => {
        this.set(false)
    }

    clear = async () => {
        this.set(true)
    }

    clearAll = async () => {
        await this.eachRepr((update, repr, rootStructure, overpaint) => {
            if (overpaint) update.delete(overpaint.transform.ref)
        })
    }

    render() {
        return <div className='msp-transform-wrapper'>
            <div className='msp-transform-header'>
                <button className='msp-btn msp-btn-block'>Current Selection Overpaint</button>
            </div>
            <div>
                <ParameterControls params={OverpaintControls.getParams(this.plugin)} values={this.state.params} onChange={p => {
                    const params = { ...this.state.params, [p.name]: p.value };
                    this.setState({ params });
                }}/>

                <div className='msp-btn-row-group'>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.add}>Add</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.clear}>Clear</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.clearAll}>Clear All</button>
                </div>
            </div>
        </div>
    }
}

type RepresentationEachStructureCallback = (update: StateBuilder.Root, structure: StateObjectCell<PluginStateObject.Molecule.Structure, StateTransform<StateTransformer<any, PluginStateObject.Molecule.Structure, any>>>) => void
const RepresentationManagerTag = 'representation-controls'

function getRepresentationManagerTag(type: string) {
    return `${RepresentationManagerTag}-${type}`
}

function getCombinedLoci(mode: 'add' | 'remove' | 'only' | 'all', loci: StructureElement.Loci, currentLoci: StructureElement.Loci): StructureElement.Loci {
    switch (mode) {
        case 'add': return StructureElement.Loci.union(loci, currentLoci)
        case 'remove': return StructureElement.Loci.subtract(currentLoci, loci)
        case 'only': return loci
        case 'all': return StructureElement.Loci.all(loci.structure)
    }
}

export class RepresentationControls extends PluginUIComponent<{}, { params: PD.Values<ReturnType<typeof RepresentationControls.getParams>> }> {
    state = { params: PD.getDefaultValues(RepresentationControls.getParams(this.plugin)) }

    static getParams = (plugin: PluginContext) => {
        const { types } = plugin.structureRepresentation.registry
        return {
            type: PD.Select(types[0][0], types)
        }
    }

    componentDidMount() {

    }

    private async eachStructure(callback: RepresentationEachStructureCallback) {
        const state = this.plugin.state.dataState;
        const structures = state.select(StateSelection.Generators.rootsOfType(PluginStateObject.Molecule.Structure));

        const update = state.build();
        for (const s of structures) {
            callback(update, s)
        }

        await this.plugin.runTask(state.updateTree(update, { doNotUpdateCurrent: true }));
    }

    set = async (mode: 'add' | 'remove' | 'only' | 'all') => {
        const state = this.plugin.state.dataState
        const { type } = this.state.params

        await this.eachStructure((update, structure) => {
            const s = structure.obj!.data
            const _loci = this.plugin.helpers.structureSelection.get(s)
            const loci = isEmptyLoci(_loci) ? StructureElement.Loci(s, []) : _loci

            const selections = state.select(StateSelection.Generators.ofType(PluginStateObject.Molecule.Structure, structure.transform.ref).withTag(getRepresentationManagerTag(type)));

            if (selections.length > 0) {
                const parsed = parseMolScript(selections[0].params!.values.query.expression)
                if (parsed.length === 0) return

                const query = transpileMolScript(parsed[0])
                const compiled = compile(query)
                const result = compiled(new QueryContext(structure.obj!.data))
                const currentLoci = StructureSelection.toLoci2(result)

                const combinedLoci = getCombinedLoci(mode, loci, currentLoci)

                update.to(selections[0]).update({
                    ...selections[0].params!.values,
                    query: { language: 'mol-script', expression: getExpression(combinedLoci) }
                })

            } else {
                const combinedLoci = getCombinedLoci(mode, loci, StructureElement.Loci(loci.structure, []))

                update.to(structure.transform.ref)
                    .apply(
                        StateTransforms.Model.UserStructureSelection,
                        {
                            query: { language: 'mol-script', expression: getExpression(combinedLoci) },
                            label: type
                        },
                        { tags: [ RepresentationManagerTag, getRepresentationManagerTag(type) ] }
                    )
                    .apply(
                        StateTransforms.Representation.StructureRepresentation3D,
                        StructureRepresentation3DHelpers.getDefaultParams(this.plugin, type as any, s)
                    )
            }
        })
    }

    show = async () => { this.set('add') }
    hide = async () => { this.set('remove') }
    only = async () => { this.set('only') }
    showAll = async () => { this.set('all') }

    hideAll = async () => {
        const { type } = this.state.params
        const state = this.plugin.state.dataState;
        const update = state.build();

        state.select(StateSelection.Generators.ofType(PluginStateObject.Molecule.Structure).withTag(getRepresentationManagerTag(type))).forEach(structure => update.delete(structure.transform.ref));

        await this.plugin.runTask(state.updateTree(update, { doNotUpdateCurrent: true }));
    }

    render() {
        return <div className='msp-transform-wrapper'>
            <div className='msp-transform-header'>
                <button className='msp-btn msp-btn-block'>Current Selection Representation</button>
            </div>
            <div>
                <ParameterControls params={RepresentationControls.getParams(this.plugin)} values={this.state.params} onChange={p => {
                    const params = { ...this.state.params, [p.name]: p.value };
                    this.setState({ params });
                }}/>

                <div className='msp-btn-row-group'>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.show}>Show</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.hide}>Hide</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.only}>Only</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.showAll}>Show All</button>
                    <button className='msp-btn msp-btn-block msp-form-control' onClick={this.hideAll}>Hide All</button>
                </div>
            </div>
        </div>
    }
}

export class StructureToolsWrapper extends PluginUIComponent {
    render() {
        return <div>
            <div className='msp-section-header'><Icon name='code' /> Structure Tools</div>

            <OverpaintControls />
            <RepresentationControls />
        </div>;
    }
}