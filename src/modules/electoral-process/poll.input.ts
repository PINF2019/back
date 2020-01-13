import { Field, ID, InputType } from 'type-graphql'
import {
  ElectoralProcessInput,
  UpdateElectoralProcessInput,
} from './electoral-process.abstract'

@InputType()
export class PollInput extends ElectoralProcessInput {
  @Field()
  question: string

  @Field(() => [String], {
    defaultValue: ['A Favor', 'En Contra', 'Abstención'],
  })
  options: string[]

  @Field()
  isRealTime: boolean
}

@InputType()
export class UpdatePollInput extends UpdateElectoralProcessInput {
  @Field({ nullable: true })
  question?: string

  @Field(() => [String], { nullable: true })
  options?: string[]
}

@InputType()
export class VotePollInput {
  @Field(() => [ID])
  options: string[]

  @Field(() => ID)
  poll: string
}
