/**
 * Copyright (c) 2018-2019 Mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { MolScriptSymbolTable as MolScript } from '../../language/symbol-table';
import { DefaultQueryRuntimeTable, QuerySymbolRuntime, QueryRuntimeArguments } from './compiler';
import { Queries, StructureProperties, StructureElement, QueryContext } from '../../../mol-model/structure';
import { ElementSymbol, LinkType } from '../../../mol-model/structure/model/types';
import { SetUtils } from '../../../mol-util/set';
import toUpperCase from '../../../mol-util/upper-case';
import { VdwRadius, AtomWeight, AtomNumber } from '../../../mol-model/structure/model/properties/atomic';
import { cantorPairing } from '../../../mol-data/util';
import C = QuerySymbolRuntime.Const
import D = QuerySymbolRuntime.Dynamic
import { bundleElementImpl, bundleGenerator } from '../../../mol-model/structure/query/queries/internal';

const symbols = [
    // ============= TYPES =============

    C(MolScript.core.type.bool, function core_type_bool(ctx, v) { return !!v[0](ctx) }),
    C(MolScript.core.type.num, function core_type_num(ctx, v) { return +v[0](ctx) }),
    C(MolScript.core.type.str, function core_type_str(ctx, v) { return '' + v[0](ctx) }),
    C(MolScript.core.type.list, function core_type_list(ctx, xs) { return QueryRuntimeArguments.forEachEval(xs, ctx, (v, i, list) => list[i] = v, [] as any[]) }),
    C(MolScript.core.type.set, function core_type_set(ctx, xs) { return QueryRuntimeArguments.forEachEval(xs, ctx, function core_type_set_argEval(v, i, set) { return set.add(v) }, new Set<any>()) }),
    C(MolScript.core.type.regex, function core_type_regex(ctx, v) { return new RegExp(v[0](ctx), (v[1] && v[1](ctx)) || '') }),
    C(MolScript.core.type.bitflags, function core_type_bitflags(ctx, v) { return +v[0](ctx) }),
    C(MolScript.core.type.compositeKey, function core_type_compositeKey(ctx, xs) { return QueryRuntimeArguments.forEachEval(xs, ctx, (v, i, list) => list[i] = '' + v, [] as string[]).join('-') }),

    // ============= LOGIC ================
    C(MolScript.core.logic.not, (ctx, v) => !v[0](ctx)),
    C(MolScript.core.logic.and, (ctx, xs) => {
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) if (!xs[i](ctx)) return false;
        } else {
            for (const k of Object.keys(xs)) if (!xs[k](ctx)) return false;
        }
        return true;
    }),
    C(MolScript.core.logic.or, (ctx, xs) => {
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) if (xs[i](ctx)) return true;
        } else {
            for (const k of Object.keys(xs)) if (xs[k](ctx)) return true;
        }
        return false;
    }),

    // ============= RELATIONAL ================
    C(MolScript.core.rel.eq, (ctx, v) => v[0](ctx) === v[1](ctx)),
    C(MolScript.core.rel.neq, (ctx, v) => v[0](ctx) !== v[1](ctx)),
    C(MolScript.core.rel.lt, (ctx, v) => v[0](ctx) < v[1](ctx)),
    C(MolScript.core.rel.lte, (ctx, v) => v[0](ctx) <= v[1](ctx)),
    C(MolScript.core.rel.gr, (ctx, v) => v[0](ctx) > v[1](ctx)),
    C(MolScript.core.rel.gre, (ctx, v) => v[0](ctx) >= v[1](ctx)),
    C(MolScript.core.rel.inRange, (ctx, v) => {
        const x = v[0](ctx);
        return x >= v[1](ctx) && x <= v[2](ctx);
    }),

    // ============= ARITHMETIC ================
    C(MolScript.core.math.add, (ctx, xs) => {
        let ret = 0;
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret += xs[i](ctx);
        } else {
            for (const k of Object.keys(xs)) ret += xs[k](ctx);
        }
        return ret;
    }),
    C(MolScript.core.math.sub, (ctx, xs) => {
        let ret = 0;
        if (typeof xs.length === 'number') {
            if (xs.length === 1) return -xs[0](ctx);
            ret = xs[0](ctx) || 0;
            for (let i = 1, _i = xs.length; i < _i; i++) ret -= xs[i](ctx);
        } else {
            const keys = Object.keys(xs);
            if (keys.length === 1)
            ret = xs[keys[0]](ctx) || 0;
            for (let i = 1, _i = keys.length; i < _i; i++) ret -= xs[keys[i]](ctx);
        }
        return ret;
    }),
    C(MolScript.core.math.mult, (ctx, xs) => {
        let ret = 1;
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret *= xs[i](ctx);
        } else {
            for (const k of Object.keys(xs)) ret *= xs[k](ctx);
        }
        return ret;
    }),
    C(MolScript.core.math.div, (ctx, v) => v[0](ctx) / v[1](ctx)),
    C(MolScript.core.math.pow, (ctx, v) => Math.pow(v[0](ctx), v[1](ctx))),
    C(MolScript.core.math.mod, (ctx, v) => v[0](ctx) % v[1](ctx)),

    C(MolScript.core.math.min, (ctx, xs) => {
        let ret = Number.POSITIVE_INFINITY;
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret = Math.min(xs[i](ctx), ret);
        } else {
            for (const k of Object.keys(xs)) ret = Math.min(xs[k](ctx), ret)
        }
        return ret;
    }),
    C(MolScript.core.math.max, (ctx, xs) => {
        let ret = Number.NEGATIVE_INFINITY;
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret = Math.max(xs[i](ctx), ret);
        } else {
            for (const k of Object.keys(xs)) ret = Math.max(xs[k](ctx), ret)
        }
        return ret;
    }),

    C(MolScript.core.math.floor, (ctx, v) => Math.floor(v[0](ctx))),
    C(MolScript.core.math.ceil, (ctx, v) => Math.ceil(v[0](ctx))),
    C(MolScript.core.math.roundInt, (ctx, v) => Math.round(v[0](ctx))),
    C(MolScript.core.math.abs, (ctx, v) => Math.abs(v[0](ctx))),
    C(MolScript.core.math.sqrt, (ctx, v) => Math.sqrt(v[0](ctx))),
    C(MolScript.core.math.cbrt, (ctx, v) => Math.cbrt(v[0](ctx))),
    C(MolScript.core.math.sin, (ctx, v) => Math.sin(v[0](ctx))),
    C(MolScript.core.math.cos, (ctx, v) => Math.cos(v[0](ctx))),
    C(MolScript.core.math.tan, (ctx, v) => Math.tan(v[0](ctx))),
    C(MolScript.core.math.asin, (ctx, v) => Math.asin(v[0](ctx))),
    C(MolScript.core.math.acos, (ctx, v) => Math.acos(v[0](ctx))),
    C(MolScript.core.math.atan, (ctx, v) => Math.atan(v[0](ctx))),
    C(MolScript.core.math.sinh, (ctx, v) => Math.sinh(v[0](ctx))),
    C(MolScript.core.math.cosh, (ctx, v) => Math.cosh(v[0](ctx))),
    C(MolScript.core.math.tanh, (ctx, v) => Math.tanh(v[0](ctx))),
    C(MolScript.core.math.exp, (ctx, v) => Math.exp(v[0](ctx))),
    C(MolScript.core.math.log, (ctx, v) => Math.log(v[0](ctx))),
    C(MolScript.core.math.log10, (ctx, v) => Math.log10(v[0](ctx))),
    C(MolScript.core.math.atan2, (ctx, v) => Math.atan2(v[0](ctx), v[1](ctx))),

    // ============= STRING ================
    C(MolScript.core.str.match, (ctx, v) => v[0](ctx).test(v[1](ctx))),
    C(MolScript.core.str.concat, (ctx, xs) => {
        let ret: string[] = [];
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret.push(xs[i](ctx).toString());
        } else {
            for (const k of Object.keys(xs)) ret.push(xs[k](ctx).toString());
        }
        return ret.join('');
    }),

    // ============= LIST ================
    C(MolScript.core.list.getAt, (ctx, v) => v[0](ctx)[v[1](ctx)]),

    // ============= SET ================
    C(MolScript.core.set.has, function core_set_has(ctx, v) { return v[0](ctx).has(v[1](ctx)) }),
    C(MolScript.core.set.isSubset, function core_set_isSubset(ctx, v) { return SetUtils.isSuperset(v[1](ctx) as Set<any>, v[0](ctx) as Set<any>) }),

    // ============= FLAGS ================
    C(MolScript.core.flags.hasAny, (ctx, v) => {
        const test = v[1](ctx);
        const tested = v[0](ctx);
        if (!test) return !!tested;
        return (tested & test) !== 0;
    }),
    C(MolScript.core.flags.hasAll, (ctx, v) => {
        const test = v[1](ctx);
        const tested = v[0](ctx);
        if (!test) return !tested;
        return (tested & test) === test;
    }),

    ////////////////////////////////////
    // Structure

    // ============= TYPES ================
    C(MolScript.structureQuery.type.elementSymbol, (ctx, v) => ElementSymbol(v[0](ctx))),
    C(MolScript.structureQuery.type.atomName, (ctx, v) => toUpperCase(v[0](ctx))),
    C(MolScript.structureQuery.type.linkFlags, (ctx, xs) => {
        let ret: LinkType = LinkType.Flag.None;
        if (typeof xs.length === 'number') {
            for (let i = 0, _i = xs.length; i < _i; i++) ret = linkFlag(ret, xs[i](ctx));
        } else {
            for (const k of Object.keys(xs)) ret = linkFlag(ret, xs[k](ctx));
        }
        return ret;
    }),

    // TODO:
    // C(MolScript.structureQuery.type.secondaryStructureFlags, (ctx, v) => StructureRuntime.AtomProperties.createSecondaryStructureFlags(env, v)),
    // C(MolScript.structureQuery.type.entityType, (ctx, v) => StructureRuntime.Common.entityType(v[0](ctx))),
    // C(MolScript.structureQuery.type.ringFingerprint, (ctx, v) => StructureRuntime.Common.ringFingerprint(env, v as any)),
    // C(MolScript.structureQuery.type.authResidueId, (ctx, v) => ResidueIdentifier.auth(v[0](ctx), v[1](ctx), v[2] && v[2](ctx))),
    // C(MolScript.structureQuery.type.labelResidueId, (ctx, v) => ResidueIdentifier.label(v[0](ctx), v[1](ctx), v[2](ctx), v[3] && v[3](ctx))),

    // ============= SLOTS ================
    // TODO: slots might not be needed after all: reducer simply pushes/pops current element
    // C(MolScript.structureQuery.slot.element, (ctx, _) => ctx_.element),
    // C(MolScript.structureQuery.slot.elementSetReduce, (ctx, _) => ctx_.element),

    // ============= FILTERS ================
    D(MolScript.structureQuery.filter.pick, (ctx, xs) => Queries.filters.pick(xs[0] as any, xs['test'])(ctx)),
    D(MolScript.structureQuery.filter.first, (ctx, xs) => Queries.filters.first(xs[0] as any)(ctx)),
    D(MolScript.structureQuery.filter.withSameAtomProperties, (ctx, xs) => Queries.filters.withSameAtomProperties(xs[0] as any, xs['source'] as any, xs['property'] as any)(ctx)),
    D(MolScript.structureQuery.filter.intersectedBy, (ctx, xs) => Queries.filters.areIntersectedBy(xs[0] as any, xs['by'] as any)(ctx)),
    D(MolScript.structureQuery.filter.within, (ctx, xs) => Queries.filters.within({
        query: xs[0] as any,
        target: xs['target'] as any,
        minRadius: xs['min-radius'] as any,
        maxRadius: xs['max-radius'] as any,
        elementRadius: xs['atom-radius'] as any,
        invert: xs['invert'] as any
    })(ctx)),
    D(MolScript.structureQuery.filter.isConnectedTo, (ctx, xs) => Queries.filters.isConnectedTo({
        query: xs[0] as any,
        target: xs['target'] as any,
        disjunct: xs['disjunct'] as any,
        invert: xs['invert'] as any,
        linkTest: xs['link-test']
    })(ctx)),

    // ============= GENERATORS ================
    D(MolScript.structureQuery.generator.atomGroups, function structureQuery_generator_atomGroups(ctx, xs) { return Queries.generators.atoms({
        entityTest: xs['entity-test'],
        chainTest: xs['chain-test'],
        residueTest: xs['residue-test'],
        atomTest: xs['atom-test'],
        groupBy: xs['group-by']
    })(ctx) }),

    D(MolScript.structureQuery.generator.all, function structureQuery_generator_all(ctx) { return Queries.generators.all(ctx) }),
    D(MolScript.structureQuery.generator.empty, function structureQuery_generator_empty(ctx) { return Queries.generators.none(ctx) }),

    // ============= MODIFIERS ================

    D(MolScript.structureQuery.modifier.includeSurroundings, function structureQuery_modifier_includeSurroundings(ctx, xs) { return Queries.modifiers.includeSurroundings(xs[0] as any, {
        radius: xs['radius'](ctx),
        wholeResidues: !!(xs['as-whole-residues'] && xs['as-whole-residues'](ctx)),
        elementRadius: xs['atom-radius']
    })(ctx) }),
    D(MolScript.structureQuery.modifier.wholeResidues, function structureQuery_modifier_wholeResidues(ctx, xs) { return Queries.modifiers.wholeResidues(xs[0] as any)(ctx) }),
    D(MolScript.structureQuery.modifier.union, function structureQuery_modifier_union(ctx, xs) { return Queries.modifiers.union(xs[0] as any)(ctx) }),
    D(MolScript.structureQuery.modifier.expandProperty, function structureQuery_modifier_expandProperty(ctx, xs) { return Queries.modifiers.expandProperty(xs[0] as any, xs['property'])(ctx) }),
    D(MolScript.structureQuery.modifier.exceptBy, function structureQuery_modifier_exceptBy(ctx, xs) { return Queries.modifiers.exceptBy(xs[0] as any, xs['by'] as any)(ctx) }),
    D(MolScript.structureQuery.modifier.includeConnected, function structureQuery_modifier_includeConnected(ctx, xs) { return Queries.modifiers.includeConnected({
        query: xs[0] as any,
        linkTest: xs['link-test'],
        wholeResidues: !!(xs['as-whole-residues'] && xs['as-whole-residues'](ctx)),
        layerCount: (xs['layer-count'] && xs['layer-count'](ctx)) || 1
    })(ctx) }),

    // ============= COMBINATORS ================

    D(MolScript.structureQuery.combinator.merge, (ctx, xs) => Queries.combinators.merge(xs as any)(ctx)),

    // ============= ATOM PROPERTIES ================

    // ~~~ CORE ~~~
    D(MolScript.structureQuery.atomProperty.core.elementSymbol, atomProp(StructureProperties.atom.type_symbol)),
    D(MolScript.structureQuery.atomProperty.core.vdw, (ctx, xs) => VdwRadius(StructureProperties.atom.type_symbol((xs && xs[0] && xs[0](ctx) as any) || ctx.element))),
    D(MolScript.structureQuery.atomProperty.core.mass, (ctx, xs) => AtomWeight(StructureProperties.atom.type_symbol((xs && xs[0] && xs[0](ctx) as any) || ctx.element))),
    D(MolScript.structureQuery.atomProperty.core.atomicNumber, (ctx, xs) => AtomNumber(StructureProperties.atom.type_symbol((xs && xs[0] && xs[0](ctx) as any) || ctx.element))),
    D(MolScript.structureQuery.atomProperty.core.x, atomProp(StructureProperties.atom.x)),
    D(MolScript.structureQuery.atomProperty.core.y, atomProp(StructureProperties.atom.y)),
    D(MolScript.structureQuery.atomProperty.core.z, atomProp(StructureProperties.atom.z)),
    D(MolScript.structureQuery.atomProperty.core.sourceIndex, atomProp(StructureProperties.atom.sourceIndex)),
    D(MolScript.structureQuery.atomProperty.core.operatorName, atomProp(StructureProperties.unit.operator_name)),
    D(MolScript.structureQuery.atomProperty.core.modelIndex, atomProp(StructureProperties.unit.model_index)),
    D(MolScript.structureQuery.atomProperty.core.modelLabel, atomProp(StructureProperties.unit.model_label)),
    D(MolScript.structureQuery.atomProperty.core.atomKey, (ctx, xs) => {
        const e = (xs && xs[0] && xs[0](ctx) as any) || ctx.element;
        return cantorPairing(e.unit.id, e.element)
    }),

    // TODO:
    // D(MolScript.structureQuery.atomProperty.core.bondCount, (ctx, _) => ),

    // ~~~ TOPOLOGY ~~~

    // TODO

    // ~~~ MACROMOLECULAR ~~~

    // TODO:
    // // identifiers
    // labelResidueId: prop((env, v) => ResidueIdentifier.labelOfResidueIndex(env.context.model, getAddress(env, v).residue)),
    // authResidueId: prop((env, v) => ResidueIdentifier.authOfResidueIndex(env.context.model, getAddress(env, v).residue)),

    // keys
    D(MolScript.structureQuery.atomProperty.macromolecular.residueKey, (ctx, xs) => StructureElement.residueIndex((xs && xs[0] && xs[0](ctx) as any) || ctx.element)),
    D(MolScript.structureQuery.atomProperty.macromolecular.chainKey, (ctx, xs) => StructureElement.chainIndex((xs && xs[0] && xs[0](ctx) as any) || ctx.element)),
    D(MolScript.structureQuery.atomProperty.macromolecular.entityKey, (ctx, xs) => StructureElement.entityIndex((xs && xs[0] && xs[0](ctx) as any) || ctx.element)),

    // mmCIF
    D(MolScript.structureQuery.atomProperty.macromolecular.id, atomProp(StructureProperties.atom.id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.isHet, (ctx, xs) => StructureProperties.residue.group_PDB((xs && xs[0] && xs[0](ctx) as any) || ctx.element) !== 'ATOM'),

    D(MolScript.structureQuery.atomProperty.macromolecular.label_atom_id, atomProp(StructureProperties.atom.label_atom_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.label_alt_id, atomProp(StructureProperties.atom.label_alt_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.label_asym_id, atomProp(StructureProperties.chain.label_asym_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.label_comp_id, atomProp(StructureProperties.residue.label_comp_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.label_seq_id, atomProp(StructureProperties.residue.label_seq_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.label_entity_id, atomProp(StructureProperties.entity.id)),

    D(MolScript.structureQuery.atomProperty.macromolecular.auth_atom_id, atomProp(StructureProperties.atom.auth_atom_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.auth_asym_id, atomProp(StructureProperties.chain.auth_asym_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.auth_comp_id, atomProp(StructureProperties.residue.auth_comp_id)),
    D(MolScript.structureQuery.atomProperty.macromolecular.auth_seq_id, atomProp(StructureProperties.residue.auth_seq_id)),

    D(MolScript.structureQuery.atomProperty.macromolecular.pdbx_PDB_ins_code, atomProp(StructureProperties.residue.pdbx_PDB_ins_code)),
    D(MolScript.structureQuery.atomProperty.macromolecular.pdbx_formal_charge, atomProp(StructureProperties.atom.pdbx_formal_charge)),
    D(MolScript.structureQuery.atomProperty.macromolecular.occupancy, atomProp(StructureProperties.atom.occupancy)),
    D(MolScript.structureQuery.atomProperty.macromolecular.B_iso_or_equiv, atomProp(StructureProperties.atom.B_iso_or_equiv)),

    D(MolScript.structureQuery.atomProperty.macromolecular.entityType, atomProp(StructureProperties.entity.type)),
    D(MolScript.structureQuery.atomProperty.macromolecular.entitySubtype, atomProp(StructureProperties.entity.subtype)),
    D(MolScript.structureQuery.atomProperty.macromolecular.objectPrimitive, atomProp(StructureProperties.unit.object_primitive)),

    D(MolScript.structureQuery.atomProperty.macromolecular.isModified, atomProp(StructureProperties.residue.isModified)),
    D(MolScript.structureQuery.atomProperty.macromolecular.modifiedParentName, atomProp(StructureProperties.residue.modifiedParentName)),
    D(MolScript.structureQuery.atomProperty.macromolecular.isNonStandard, atomProp(StructureProperties.residue.isNonStandard)),
    D(MolScript.structureQuery.atomProperty.macromolecular.secondaryStructureKey, atomProp(StructureProperties.residue.secondary_structure_key)),
    D(MolScript.structureQuery.atomProperty.macromolecular.secondaryStructureFlags, atomProp(StructureProperties.residue.secondary_structure_type)),
    D(MolScript.structureQuery.atomProperty.macromolecular.chemCompType, atomProp(StructureProperties.residue.chem_comp_type)),

    // ============= BOND PROPERTIES ================
    D(MolScript.structureQuery.linkProperty.order, (ctx, xs) => ctx.atomicLink.order),
    D(MolScript.structureQuery.linkProperty.flags, (ctx, xs) => ctx.atomicLink.type),
    D(MolScript.structureQuery.linkProperty.atomA, (ctx, xs) => ctx.atomicLink.a),
    D(MolScript.structureQuery.linkProperty.atomB, (ctx, xs) => ctx.atomicLink.b),
    D(MolScript.structureQuery.linkProperty.length, (ctx, xs) => ctx.atomicLink.length),


    ////////////////////////////////////
    // Internal
    D(MolScript.internal.generator.bundleElement, function internal_generator_bundleElement(ctx, xs) { return bundleElementImpl(xs.groupedUnits(ctx), xs.ranges(ctx), xs.set(ctx)) }),
    D(MolScript.internal.generator.bundle, function internal_generator_bundle(ctx, xs) { return bundleGenerator(xs.elements(ctx))(ctx) }),
    D(MolScript.internal.generator.current, function internal_generator_current(ctx, xs) { return ctx.tryGetCurrentSelection() }),
];

function atomProp(p: (e: StructureElement.Location) => any): (ctx: QueryContext, xs: any) => any {
    return (ctx, xs) => p((xs && xs[0] && xs[0](ctx) as any) || ctx.element);
}

function linkFlag(current: LinkType, f: string): LinkType {
    switch (f.toLowerCase()) {
        case 'covalent': return current | LinkType.Flag.Covalent;
        case 'metallic': return current | LinkType.Flag.MetallicCoordination;
        case 'ion': return current | LinkType.Flag.Ionic;
        case 'hydrogen': return current | LinkType.Flag.Hydrogen;
        case 'sulfide': return current | LinkType.Flag.Sulfide;
        case 'aromatic': return current | LinkType.Flag.Aromatic;
        case 'computed': return current | LinkType.Flag.Computed;
        default: return current;
    }
}

(function () {
    for (const s of symbols) {
        DefaultQueryRuntimeTable.addSymbol(s);
    }
})();