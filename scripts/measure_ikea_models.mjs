// Recover missing lamp extents only when the model's scale agrees with published dimensions.
import fs from 'node:fs'
import { Object3D, Box3, Vector3, Matrix4 } from '../frontend/node_modules/three/build/three.module.js'
const path='data/ikea-catalog.json'
const data=JSON.parse(fs.readFileSync(path))
for(const p of data.products.filter(p=>p.modelUrl && p.lighting)){
 if(p.dimensionSources?.width==='Visible measurements: Length'){p.dimensionsMeters.width=null;delete p.dimensionSources.width}
 if(Object.values(p.dimensionsMeters).every(Boolean))continue
 const b=fs.readFileSync('frontend/public'+p.modelUrl)
 const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())
 const box=new Box3()
 function visit(id,parent){
  const n=j.nodes[id],obj=new Object3D()
  if(n.matrix)obj.matrix.fromArray(n.matrix)
  else{if(n.translation)obj.position.fromArray(n.translation);if(n.rotation)obj.quaternion.fromArray(n.rotation);if(n.scale)obj.scale.fromArray(n.scale);obj.updateMatrix()}
  const matrix=new Matrix4().multiplyMatrices(parent,obj.matrix)
  if(n.mesh!==undefined)for(const primitive of j.meshes[n.mesh].primitives){const a=j.accessors[primitive.attributes.POSITION];if(a.min&&a.max)box.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)).applyMatrix4(matrix))}
  for(const c of n.children??[])visit(c,matrix)
 }
 for(const n of j.scenes[j.scene??0].nodes)visit(n,new Matrix4())
 const sizes=box.getSize(new Vector3()).toArray(),axes=['width','height','depth']
 const ratios=axes.flatMap((axis,i)=>p.dimensionsMeters[axis]?[p.dimensionsMeters[axis]/sizes[i]]:[])
 if(!ratios.length||ratios.some(r=>!Number.isFinite(r)||Math.abs(r-1)>.1)){p.modelDimensionReview='Model does not agree with published dimensions within 10%; manual review needed.';continue}
 const scale=ratios.reduce((a,b)=>a+b,0)/ratios.length
 for(let i=0;i<3;i++)if(!p.dimensionsMeters[axes[i]]){p.dimensionsMeters[axes[i]]=Math.round(sizes[i]*scale*1000)/1000;p.dimensionSources[axes[i]]='Measured GLB bounds; scale checked against published dimensions (10% tolerance)'}
 p.dimensionsMeasuredFromModel=true
 console.log('Measured lamp footprint:',p.name,p.dimensionsMeters)
}
fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n')
