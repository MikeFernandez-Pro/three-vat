import { UniformType, UniformValue, UniformValueObj } from '../utils/SquareDataTexture.js';
type UniformSchema = {
    [x: string]: UniformType;
};
type UniformSchemaShader = {
    vertex?: UniformSchema;
    fragment?: UniformSchema;
};
declare module '../InstancedMesh2.js' {
    interface InstancedMesh2 {
        /**
         * Retrieves a uniform value for a specific instance.
         * @param id The index of the instance.
         * @param name The name of the uniform.
         * @param target Optional target object to store the uniform value.
         * @returns The uniform value for the specified instance.
         */
        getUniformAt(id: number, name: string, target?: UniformValueObj): UniformValue;
        /**
         * Sets a uniform value for a specific instance.
         * @param id The index of the instance.
         * @param name The name of the uniform.
         * @param value The value to set for the uniform.
         */
        setUniformAt(id: number, name: string, value: UniformValue): void;
        /**
         * Initializes per-instance uniforms using a schema.
         * @param schema The schema defining the uniforms.
         */
        initUniformsPerInstance(schema: UniformSchemaShader): void;
    }
}
export {};
//# sourceMappingURL=Uniforms.d.ts.map