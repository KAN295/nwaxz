type Turn={z:number;direction:"left"|"right"};
type Corner=Turn&{x:number;y:number;heading:number;out:number};
export class RunnerRoute3D {
  private corners:Corner[]=[];
  private base={z:0,x:0,y:0,heading:0};
  sync(turns:readonly Turn[],distance:number){
    for(const turn of [...turns].sort((a,b)=>a.z-b.z)){
      if(turn.z<=this.base.z||this.corners.some(c=>c.z===turn.z))continue;
      const last=this.corners.at(-1),start=last?{z:last.z,x:last.x,y:last.y,heading:last.out}:this.base;
      this.corners.push({...turn,x:start.x+Math.sin(start.heading)*(turn.z-start.z),y:start.y+Math.cos(start.heading)*(turn.z-start.z),heading:start.heading,out:start.heading+(turn.direction==="left"?-1:1)*Math.PI/2});
    }
    while(this.corners.length>3&&this.corners[1].z<distance-80){const c=this.corners.shift()!;this.base={z:c.z,x:c.x,y:c.y,heading:c.out};}
  }
  sample(distance:number){
    let start=this.base;
    for(const c of this.corners){
      if(distance<c.z-12)break;
      if(distance<=c.z+12){
        const angle=(distance-c.z+12)/24*Math.PI/2,r=12;
        const dx=Math.sin(c.heading),dz=Math.cos(c.heading),ox=Math.sin(c.out),oz=Math.cos(c.out);
        return {x:c.x-dx*r+ox*r-ox*r*Math.cos(angle)+dx*r*Math.sin(angle),z:c.y-dz*r+oz*r-oz*r*Math.cos(angle)+dz*r*Math.sin(angle),heading:c.heading+(c.out-c.heading)*(distance-c.z+12)/24};
      }
      start={z:c.z,x:c.x,y:c.y,heading:c.out};
    }
    return {x:start.x+Math.sin(start.heading)*(distance-start.z),z:start.y+Math.cos(start.heading)*(distance-start.z),heading:start.heading};
  }
  get storedCorners(){return this.corners.length;}
}
