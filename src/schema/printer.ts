/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
/* eslint-disable class-methods-use-this */

import {
  asJsonArray,
  asJsonMap,
  asNumber,
  asString,
  isJsonMap,
  JsonArray,
  JsonMap,
  Optional,
} from '@salesforce/ts-types';
import { Logger } from '../logger/logger';
import { SfError } from '../sfError';

/**
 * Renders schema properties.  By default, this is simply an identity transform.  Subclasses may provide more
 * interesting decorations of each values, such as ANSI coloring.
 *
 * @deprecated
 *
 */
export class SchemaPropertyRenderer {
  /**
   * Renders a name.
   *
   * @param name The name value to render.
   */
  public renderName(name: string): string {
    return name;
  }

  /**
   * Renders a title.
   *
   * @param title The title value to render.
   */
  public renderTitle(title: string): string {
    return title;
  }

  /**
   * Renders a description.
   *
   * @param description The description value to render.
   */
  public renderDescription(description: string): string {
    return description;
  }

  /**
   * Renders a type.
   *
   * @param propertyType The type value to render.
   */
  public renderType(propertyType: string): string {
    return propertyType;
  }
}

/**
 * Prints a JSON schema in a human-friendly format.
 *
 * @deprecated
 * remaining reference: https://github.com/salesforcecli/plugin-data/blob/cc1bdfa2c707f93a6da96beea8117b25f9612d4a/src/commands/data/import/tree.ts#L75
 *
 * ```
 * import chalk from 'chalk';
 * class MyPropertyRenderer extends SchemaPropertyRenderer {
 *   renderName(name) { return chalk.bold.blue(name); }
 * }
 *
 * const printer = new SchemaPrinter(logger, schema, new MyPropertyRenderer());
 * printer.getLines().forEach(console.log);
 * ```
 */
export class SchemaPrinter {
  private logger: Logger;
  private lines: string[] = [];

  /**
   * Constructs a new `SchemaPrinter`.
   *
   * @param logger The logger to use when emitting the printed schema.
   * @param schema The schema to print.
   * @param propertyRenderer The property renderer.
   */
  public constructor(
    logger: Logger,
    private schema: JsonMap,
    private propertyRenderer: SchemaPropertyRenderer = new SchemaPropertyRenderer()
  ) {
    this.logger = logger.child('SchemaPrinter');

    if (!this.schema.properties && !this.schema.items) {
      // No need to add to messages, since this should never happen. In fact,
      // this will cause a test failure if there is a command that uses a schema
      // with no properties defined.
      throw new SfError('There is no purpose to print a schema with no properties or items');
    }

    const startLevel = 0;
    const add = this.addFn(startLevel);

    // For object schemas, print out the "header" and first level properties differently
    if (this.schema.properties) {
      if (typeof this.schema.description === 'string') {
        // Output the overall schema description before printing the properties
        add(this.schema.description);
        add('');
      }

      Object.keys(this.schema.properties).forEach((key) => {
        const properties = asJsonMap(this.schema.properties);
        if (!properties) {
          return;
        }
        this.parseProperty(key, asJsonMap(properties[key]), startLevel);
        add('');
      });
    } else {
      this.parseProperty('schema', this.schema, startLevel);
    }
  }

  /**
   * Gets a read-only array of ready-to-display lines.
   */
  public getLines(): readonly string[] {
    return this.lines;
  }

  /**
   * Gets a ready-to-display line by index.
   *
   * @param index The line index to get.
   */
  public getLine(index: number): string {
    return this.lines[index];
  }

  /**
   * Prints the accumulated set of schema lines as info log lines to the logger.
   */
  public print(): void {
    this.lines.forEach((line) => this.logger.info(line));
  }

  private addFn(level: number): (line: string) => void {
    const indent = ' '.repeat(level * 4);
    return (line: string) => {
      this.lines.push(`${indent}${line}`);
    };
  }

  private parseProperty(name: string, rawProperty?: JsonMap, level = 0): void {
    if (!rawProperty) {
      return;
    }

    const add = this.addFn(level);
    const property = new SchemaProperty(this.logger, this.schema, name, rawProperty, this.propertyRenderer);

    add(property.renderHeader());

    if (property.type === 'object' && property.properties) {
      Object.keys(property.properties).forEach((key) => {
        this.parseProperty(key, property.getProperty(key), level + 1);
      });
    }
    if (property.type === 'array') {
      add(`    ${property.renderArrayHeader()}`);
      if (property.items && property.items.type === 'object' && property.items.properties) {
        Object.keys(property.items.properties).forEach((key) => {
          const items = asJsonMap(property.items);
          if (!items) {
            return;
          }
          const properties = asJsonMap(items.properties);
          if (!properties) {
            return;
          }
          this.parseProperty(key, asJsonMap(properties[key]), level + 2);
        });
      }
    }
    if (property.required) {
      add(`Required: ${property.required.join(', ')}`);
    }
  }
}

class SchemaProperty {
  public constructor(
    private readonly logger: Logger,
    private readonly schema: JsonMap,
    private readonly name: string,
    private rawProperty: JsonMap,
    private propertyRenderer: SchemaPropertyRenderer
  ) {
    this.name = name;

    // Capture the referenced definition, if specified
    if (typeof this.rawProperty.$ref === 'string') {
      // Copy the referenced property while adding the original property's properties on top of that --
      // if they are defined here, they take precedence over referenced definition properties.
      this.rawProperty = Object.assign({}, resolveRef(this.schema, this.rawProperty), rawProperty);
    }

    const oneOfs = asJsonArray(this.rawProperty.oneOf);
    if (oneOfs && !this.rawProperty.type) {
      this.rawProperty.type = oneOfs.map((value) => (isJsonMap(value) ? value.type ?? value.$ref : value)).join('|');
    }

    // Handle items references
    if (isJsonMap(this.items) && this.items && this.items.$ref) {
      Object.assign(this.items, resolveRef(this.schema, this.items));
    }
  }

  public get title(): Optional<string> {
    return asString(this.rawProperty.title);
  }

  public get description(): Optional<string> {
    return asString(this.rawProperty.description);
  }

  public get type(): Optional<string> {
    return asString(this.rawProperty.type);
  }

  public get required(): Optional<JsonArray> {
    return asJsonArray(this.rawProperty.required);
  }

  public get properties(): Optional<JsonMap> {
    return asJsonMap(this.rawProperty.properties);
  }

  public get items(): Optional<JsonMap> {
    return asJsonMap(this.rawProperty.items);
  }

  public get minItems(): Optional<number> {
    return asNumber(this.rawProperty.minItems);
  }

  public getProperty(key: string): Optional<JsonMap> {
    const properties = this.getProperties();
    return asJsonMap(properties?.[key]);
  }

  public getProperties(): Optional<JsonMap> {
    return asJsonMap(this.rawProperty.properties);
  }

  public renderName(): string {
    return this.propertyRenderer.renderName(this.name);
  }

  public renderTitle(): string {
    return this.propertyRenderer.renderTitle(this.title ?? '');
  }

  public renderDescription(): string {
    return this.propertyRenderer.renderDescription(this.description ?? '');
  }

  public renderType(): string {
    return this.propertyRenderer.renderType(this.type ?? '');
  }

  public renderHeader(): string {
    return `${this.renderName()}(${this.renderType()}) - ${this.renderTitle()}: ${this.renderDescription()}`;
  }

  public renderArrayHeader(): string {
    if (!this.items) {
      return '';
    }
    const minItems = this.minItems ? ` - min ${this.minItems}` : '';
    const prop = new SchemaProperty(this.logger, this.schema, 'items', this.items, this.propertyRenderer);
    return `items(${prop.renderType()}${minItems}) - ${prop.renderTitle()}: ${prop.renderDescription()}`;
  }
}

/**
 * Get the referenced definition by following the reference path on the current schema.
 *
 * @param schema The source schema containing the property containing a `$ref` field.
 * @param property The property that contains the `$ref` field.
 */
function resolveRef(schema: JsonMap, property: JsonMap): JsonMap | null {
  const ref = property.$ref;
  if (!ref || typeof ref !== 'string') {
    return null;
  }
  return ref.split('/').reduce((prev, key) => {
    const next = prev[key];
    return key === '#' ? schema : isJsonMap(next) ? next : {};
  }, property);
}
